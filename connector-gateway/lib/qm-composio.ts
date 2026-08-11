import "server-only";

import { createComposioClient } from "@/lib/composio";
import {
  QmComposioError,
  assertScopeOperation,
  assertToolPolicy,
  decodeCursor,
  encodeCursor,
  normalizeInbox,
  normalizeInboxThread,
  normalizeToolkitCatalog,
  normalizeKnowledgeRecords,
  toolIsReadOnly,
  validateToolkit,
  validateToolSlug,
  type QmToolkitCard,
  type QmCapability,
  type QmInboxSource,
} from "@/lib/qm-composio-policy";

type JsonObject = Record<string, unknown>;
type RawTool = {
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  toolkit?: { slug?: string; name?: string };
  inputParameters?: { required?: string[]; properties?: Record<string, JsonObject> };
};

let qmClient: ReturnType<typeof createComposioClient> | null = null;
let toolkitCatalogCache: { at: number; items: QmToolkitCard[] } | null = null;
const inboxSendRequests = new Map<string, { at: number; result: Promise<{ status: "sent"; requestId: string }> }>();

function client() {
  const apiKey = process.env.QM_COMPOSIO_API_KEY;
  if (!apiKey) throw new QmComposioError(503, "gateway_not_configured", "QM Composio is not configured.");
  qmClient ??= createComposioClient(apiKey, false);
  return qmClient;
}

function authConfigIds() {
  const raw = process.env.QM_COMPOSIO_AUTH_CONFIGS_JSON?.trim();
  if (!raw) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [toolkit, value] of Object.entries(parsed)) {
      const id =
        typeof value === "string"
          ? value
          : value && typeof value === "object"
            ? String((value as JsonObject).id ?? (value as JsonObject).authConfigId ?? "")
            : "";
      if (/^[A-Za-z0-9_-]{3,128}$/.test(id)) result[toolkit.toLowerCase()] = id;
    }
    return result;
  } catch {
    throw new QmComposioError(503, "gateway_not_configured", "QM Composio auth configs are invalid.");
  }
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as JsonObject;
  for (const candidate of [value.status, value.statusCode, object(value.response)?.status]) {
    if (typeof candidate === "number") return candidate;
  }
  return null;
}

function providerFailure(error: unknown): QmComposioError {
  if (error instanceof QmComposioError) return error;
  const status = providerStatus(error);
  if (status === 429) return new QmComposioError(429, "provider_rate_limited", "Connector provider is rate limited.", true);
  if (status && status >= 500) {
    return new QmComposioError(502, "provider_unavailable", "Connector provider is unavailable.", true);
  }
  return new QmComposioError(502, "provider_error", "Connector provider request failed.");
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function list(value: unknown): JsonObject[] {
  const record = object(value);
  const items = Array.isArray(value) ? value : Array.isArray(record?.items) ? record.items : [];
  return items.map(object).filter((item): item is JsonObject => item !== null);
}

function scalar(value: unknown, keys: string[], depth = 0): string | null {
  const record = object(value);
  if (!record || depth > 4) return null;
  for (const key of keys) {
    const found = record[key];
    if (typeof found === "string" && found.length <= 4096) return found;
    if (typeof found === "number") return String(found);
  }
  for (const key of ["data", "result", "response", "output", "meta"]) {
    const found = scalar(record[key], keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function validIso(value: unknown, fallback?: string) {
  if (value === undefined || value === null || value === "") {
    if (fallback) return fallback;
    throw new QmComposioError(400, "invalid_window", "A valid ISO sync window is required.");
  }
  if (typeof value !== "string" || value.length > 64) {
    throw new QmComposioError(400, "invalid_window", "A valid ISO sync window is required.");
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new QmComposioError(400, "invalid_window", "A valid ISO sync window is required.");
  }
  return date.toISOString();
}

function compactInput(tool: RawTool) {
  const properties = tool.inputParameters?.properties ?? {};
  return {
    required: tool.inputParameters?.required ?? [],
    properties: Object.fromEntries(
      Object.entries(properties)
        .slice(0, 20)
        .map(([name, schema]) => [
          name,
          {
            type: typeof schema.type === "string" ? schema.type : undefined,
            description: typeof schema.description === "string" ? schema.description.slice(0, 300) : undefined,
          },
        ]),
    ),
  };
}

async function rawTool(slug: string): Promise<RawTool> {
  try {
    return (await client().tools.getRawComposioToolBySlug(slug, undefined, {
      signal: AbortSignal.timeout(10000),
    })) as RawTool;
  } catch (error) {
    throw providerFailure(error);
  }
}

async function sessionFor(identity: string, toolkit: string, toolSlug?: string) {
  const authConfigId = authConfigIds()[toolkit];
  try {
    return await client().create(
      identity,
      {
        ...(toolSlug
          ? {
              sessionPreset: "direct_tools" as const,
              tools: { [toolkit]: [toolSlug] },
              preload: { tools: [toolSlug] },
            }
          : { toolkits: [toolkit] }),
        ...(authConfigId ? { authConfigs: { [toolkit]: authConfigId } } : {}),
        manageConnections: false,
        workbench: { enable: false },
      },
      { signal: AbortSignal.timeout(10000) },
    );
  } catch (error) {
    throw providerFailure(error);
  }
}

async function run(identity: string, toolkit: string, slug: string, input: JsonObject) {
  const session = await sessionFor(identity, toolkit, slug);
  try {
    const result = await session.execute(slug, input);
    if (result.error) throw new QmComposioError(502, "tool_execution_failed", "Connector tool execution failed.");
    return result.data;
  } catch (error) {
    throw providerFailure(error);
  }
}

function filteredInput(tool: RawTool, values: JsonObject) {
  const allowed = new Set(Object.keys(tool.inputParameters?.properties ?? {}));
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => allowed.has(key) && value !== undefined));
}

async function runCurated(identity: string, slug: string, values: JsonObject) {
  const tool = await rawTool(slug);
  if (!toolIsReadOnly(tool.tags)) {
    throw new QmComposioError(503, "unsafe_tool_metadata", `Required sync tool ${slug} is not marked read-only.`);
  }
  const toolkit = tool.toolkit?.slug?.toLowerCase();
  if (!toolkit) throw new QmComposioError(502, "invalid_tool_metadata", "Connector tool metadata is incomplete.");
  return run(identity, toolkit, slug, filteredInput(tool, values));
}

export async function connectToolkit(identity: string, toolkitValue: unknown, capability: QmCapability, callbackUrl: string) {
  assertScopeOperation(capability, "connect");
  const toolkit = validateToolkit(toolkitValue);
  const authConfigId = authConfigIds()[toolkit];
  if (toolkit === "fathom" && !authConfigId) {
    throw new QmComposioError(
      409,
      "admin_setup_required",
      "Fathom requires its preconfigured API-key auth config before teammates can connect.",
    );
  }
  if (authConfigId) {
    let config;
    try {
      config = await client().authConfigs.get(authConfigId, { signal: AbortSignal.timeout(10000) });
    } catch (error) {
      throw providerFailure(error);
    }
    if (config.toolkit.slug.toLowerCase() !== toolkit || config.status !== "ENABLED") {
      throw new QmComposioError(409, "admin_setup_required", "The toolkit auth config needs administrator setup.");
    }
    if (toolkit === "fathom" && config.authScheme !== "API_KEY") {
      throw new QmComposioError(409, "admin_setup_required", "Fathom must use the approved API-key auth config.");
    }
  }

  const session = await sessionFor(identity, toolkit);
  try {
    const request = await session.authorize(toolkit, { callbackUrl });
    if (!request.redirectUrl) {
      throw new QmComposioError(502, "missing_connect_url", "Connector provider did not return a connect URL.");
    }
    return { toolkit, status: request.status, connectUrl: request.redirectUrl };
  } catch (error) {
    if (error instanceof QmComposioError) throw error;
    const status = providerStatus(error);
    if (!authConfigId && status !== 429 && !(status && status >= 500)) {
      throw new QmComposioError(
        409,
        "admin_setup_required",
        "This toolkit needs one administrator auth-config setup before teammate self-service.",
      );
    }
    throw providerFailure(error);
  }
}

export async function listConnections(identity: string, capability: QmCapability) {
  assertScopeOperation(capability, "connections");
  try {
    const response = await client().connectedAccounts.list(
      { userIds: [identity] },
      { signal: AbortSignal.timeout(10000) },
    );
    return list(response).map((item) => ({
      toolkit: String(object(item.toolkit)?.slug ?? item.toolkitSlug ?? object(item.authConfig)?.toolkitSlug ?? ""),
      status: String(item.status ?? "UNKNOWN"),
      active: String(item.status ?? "").toUpperCase() === "ACTIVE",
    }));
  } catch (error) {
    throw providerFailure(error);
  }
}

export async function listToolkits(capability: QmCapability) {
  assertScopeOperation(capability, "connections");
  if (toolkitCatalogCache && Date.now() - toolkitCatalogCache.at < 86_400_000) {
    return { toolkits: toolkitCatalogCache.items };
  }
  try {
    const configured = authConfigIds();
    const response = await client().toolkits.get(
      { sortBy: "usage", limit: 999 },
      { signal: AbortSignal.timeout(10000) },
    );
    const toolkits = normalizeToolkitCatalog(list(response), configured);
    toolkitCatalogCache = { at: Date.now(), items: toolkits };
    return { toolkits };
  } catch (error) {
    throw providerFailure(error);
  }
}

export async function searchTools(identity: string, queryValue: unknown, toolkitValue: unknown, capability: QmCapability) {
  assertScopeOperation(capability, "search");
  void identity;
  if (typeof queryValue !== "string" || !queryValue.trim() || queryValue.length > 500) {
    throw new QmComposioError(400, "invalid_query", "A search query of at most 500 characters is required.");
  }
  const toolkit = toolkitValue === undefined ? undefined : validateToolkit(toolkitValue);
  try {
    const response = toolkit
      ? await client().tools.getRawComposioTools(
          { toolkits: [toolkit], search: queryValue.trim(), limit: 12 },
          undefined,
          { signal: AbortSignal.timeout(10000) },
        )
      : await client().tools.getRawComposioTools(
          { search: queryValue.trim() },
          undefined,
          { signal: AbortSignal.timeout(10000) },
        );
    const tools = list(response)
      .map((item) => item as unknown as RawTool)
      .filter((tool) => toolIsReadOnly(tool.tags))
      .slice(0, 8)
      .map((tool) => ({
        slug: tool.slug,
        name: tool.name,
        toolkit: tool.toolkit?.slug ?? "",
        description: tool.description?.slice(0, 500) ?? "",
        input: compactInput(tool),
      }));
    return { tools };
  } catch (error) {
    throw providerFailure(error);
  }
}

export async function executeTool(
  identity: string,
  toolSlugValue: unknown,
  inputValue: unknown,
  modeValue: unknown,
  capability: QmCapability,
) {
  const toolSlug = validateToolSlug(toolSlugValue);
  if (modeValue !== "read") {
    throw new QmComposioError(403, "mutations_disabled", "QM connector mutations are not enabled.");
  }
  const input = object(inputValue);
  if (!input) throw new QmComposioError(400, "invalid_input", "Tool input must be a JSON object.");
  const tool = await rawTool(toolSlug);
  assertToolPolicy(tool, capability);
  const toolkit = tool.toolkit?.slug?.toLowerCase();
  if (!toolkit) throw new QmComposioError(502, "invalid_tool_metadata", "Connector tool metadata is incomplete.");
  return { httpStatus: 200, body: { status: "succeeded", toolSlug, data: await run(identity, toolkit, toolSlug, input) } };
}

const INBOX_SOURCES = new Set<QmInboxSource>(["gmail", "outlook", "slack"]);

function inboxSource(value: unknown): QmInboxSource {
  const source = typeof value === "string" ? value.toLowerCase() : "";
  if (!INBOX_SOURCES.has(source as QmInboxSource)) {
    throw new QmComposioError(400, "invalid_source", "Choose Gmail, Outlook, or Slack.");
  }
  return source as QmInboxSource;
}

function inboxText(value: unknown, max: number, name: string, required = true): string {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) {
    throw new QmComposioError(400, `invalid_${name}`, `A valid ${name} is required.`);
  }
  return result;
}

function sourceRequest(source: QmInboxSource, query: string) {
  if (source === "gmail") {
    return { slug: "GMAIL_FETCH_EMAILS", input: { query: ["newer_than:30d", query].filter(Boolean).join(" "), max_results: 30, include_payload: false, verbose: false } };
  }
  if (source === "outlook") {
    return { slug: "OUTLOOK_LIST_MESSAGES", input: { top: 30, folder: "inbox", orderby: "receivedDateTime desc", ...(query ? { search: query } : {}) } };
  }
  const after = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  return { slug: "SLACK_SEARCH_MESSAGES", input: { query: [query, `after:${after}`].filter(Boolean).join(" "), count: 50, sort: "timestamp", sort_dir: "desc", highlight: false } };
}

export async function listInbox(
  identity: string,
  sourcesValue: unknown,
  queryValue: unknown,
  capability: QmCapability,
) {
  assertScopeOperation(capability, "read");
  if (!capability.scopeId.startsWith("personal:")) {
    throw new QmComposioError(403, "personal_scope_required", "Open Inbox from your personal workspace.");
  }
  const query = inboxText(queryValue ?? "", 200, "query", false);
  const requested = sourcesValue === undefined
    ? [...INBOX_SOURCES]
    : Array.isArray(sourcesValue)
      ? [...new Set(sourcesValue.map(inboxSource))]
      : [inboxSource(sourcesValue)];
  const connected = new Set(
    (await listConnections(identity, capability))
      .filter((connection) => connection.active)
      .map((connection) => connection.toolkit.toLowerCase()),
  );
  const sources = requested.filter((source) => connected.has(source));
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const request = sourceRequest(source, query);
      return normalizeInbox(source, await runCurated(identity, request.slug, request.input));
    }),
  );
  return {
    connected: requested.filter((source) => connected.has(source)),
    conversations: results
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
      .slice(0, 100),
    warnings: results.flatMap((result, index) => result.status === "rejected" ? [sources[index]] : []),
  };
}

export async function readInboxThread(
  identity: string,
  sourceValue: unknown,
  threadIdValue: unknown,
  channelIdValue: unknown,
  capability: QmCapability,
) {
  assertScopeOperation(capability, "read");
  if (!capability.scopeId.startsWith("personal:")) {
    throw new QmComposioError(403, "personal_scope_required", "Open Inbox from your personal workspace.");
  }
  const source = inboxSource(sourceValue);
  const threadId = inboxText(threadIdValue, 512, "thread");
  let request: { slug: string; input: JsonObject };
  if (source === "gmail") request = { slug: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", input: { thread_id: threadId } };
  else if (source === "outlook") request = { slug: "OUTLOOK_LIST_MESSAGES", input: { conversation_id: threadId, top: 50, orderby: "receivedDateTime asc" } };
  else {
    const channel = inboxText(channelIdValue, 128, "channel");
    request = { slug: "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION", input: { channel, ts: threadId, limit: 100 } };
  }
  return { source, threadId, messages: normalizeInboxThread(source, await runCurated(identity, request.slug, request.input)) };
}

function inboxSendInput(source: QmInboxSource, input: JsonObject): { slug: string; values: JsonObject } {
  const text = inboxText(input.text, 8_000, "message");
  const threadId = inboxText(input.threadId ?? "", 512, "thread", false);
  const recipient = inboxText(input.recipient ?? "", 500, "recipient", false);
  const subject = inboxText(input.subject ?? "", 300, "subject", false);
  if (source !== "slack" && recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new QmComposioError(400, "invalid_recipient", "Enter a valid email address.");
  }
  if (source === "gmail") {
    return threadId
      ? { slug: "GMAIL_REPLY_TO_THREAD", values: { thread_id: threadId, message_body: text, ...(recipient ? { recipient_email: recipient } : {}) } }
      : { slug: "GMAIL_SEND_EMAIL", values: { recipient_email: inboxText(recipient, 254, "recipient"), subject, body: text } };
  }
  if (source === "outlook") {
    const messageId = inboxText(input.messageId ?? "", 512, "message_id", false);
    return messageId
      ? { slug: "OUTLOOK_REPLY_EMAIL", values: { message_id: messageId, comment: text } }
      : { slug: "OUTLOOK_SEND_EMAIL", values: { to: inboxText(recipient, 254, "recipient"), subject: inboxText(subject, 300, "subject"), body: text } };
  }
  const channel = inboxText(input.channelId ?? recipient, 128, "channel");
  return { slug: "SLACK_SEND_MESSAGE", values: { channel, markdown_text: text, ...(threadId ? { thread_ts: threadId } : {}) } };
}

export async function sendInboxMessage(
  identity: string,
  input: JsonObject,
  capability: QmCapability,
) {
  assertScopeOperation(capability, "send");
  if (input.confirmed !== true) {
    throw new QmComposioError(400, "confirmation_required", "Confirm the exact message before sending.");
  }
  const requestId = inboxText(input.requestId, 128, "request_id");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    throw new QmComposioError(400, "invalid_request_id", "A valid request ID is required.");
  }
  const key = `${identity}:${requestId}`;
  const cutoff = Date.now() - 10 * 60_000;
  for (const [storedKey, stored] of inboxSendRequests) if (stored.at < cutoff) inboxSendRequests.delete(storedKey);
  const previous = inboxSendRequests.get(key);
  if (previous) return previous.result;
  const source = inboxSource(input.source);
  const send = inboxSendInput(source, input);
  const result = (async () => {
    const tool = await rawTool(send.slug);
    if (tool.toolkit?.slug?.toLowerCase() !== source || toolIsReadOnly(tool.tags) || tool.tags?.includes("destructiveHint")) {
      throw new QmComposioError(503, "unsafe_tool_metadata", "This send action is not available.");
    }
    await run(identity, source, send.slug, filteredInput(tool, send.values));
    return { status: "sent" as const, requestId };
  })();
  // ponytail: process-local idempotency covers double clicks on the single gateway replica; use a shared store before horizontal scaling.
  inboxSendRequests.set(key, { at: Date.now(), result });
  try {
    return await result;
  } catch (error) {
    inboxSendRequests.delete(key);
    throw error;
  }
}

async function syncGmail(identity: string, cursorValue: unknown, windowStartValue: unknown, limit: number) {
  const now = new Date().toISOString();
  const cursor = decodeCursor(cursorValue);
  if (cursor && cursor.toolkit !== "gmail") throw new QmComposioError(400, "invalid_cursor", "Cursor is for another toolkit.");
  if (cursor && cursor.phase !== "initial" && cursor.phase !== "history") {
    throw new QmComposioError(400, "invalid_cursor", "Gmail cursor phase is invalid.");
  }
  const phase = cursor?.phase === "history" ? "history" : "initial";

  if (phase === "initial") {
    const windowStart = validIso(cursor?.windowStart ?? windowStartValue, new Date(Date.now() - 30 * 86400000).toISOString());
    const pageToken = typeof cursor?.pageToken === "string" ? cursor.pageToken : undefined;
    const data = await runCurated(identity, "GMAIL_FETCH_EMAILS", {
      query: `after:${Math.floor(new Date(windowStart).valueOf() / 1000)}`,
      max_results: limit,
      page_token: pageToken,
      include_payload: false,
    });
    const nextPage = scalar(data, ["nextPageToken", "next_page_token"]);
    if (nextPage) {
      return {
        records: normalizeKnowledgeRecords("gmail", data),
        cursor: encodeCursor({ toolkit: "gmail", phase: "initial", windowStart, pageToken: nextPage }),
        hasMore: true,
        phase: "initial",
      };
    }
    const profile = await runCurated(identity, "GMAIL_GET_PROFILE", {});
    const historyId = scalar(profile, ["historyId", "history_id"]);
    if (!historyId) throw new QmComposioError(502, "missing_history_cursor", "Gmail did not return a history cursor.");
    return {
      records: normalizeKnowledgeRecords("gmail", data),
      cursor: encodeCursor({ toolkit: "gmail", phase: "history", historyId, since: now }),
      hasMore: false,
      phase: "history",
    };
  }

  const historyId = typeof cursor?.historyId === "string" ? cursor.historyId : "";
  const since = validIso(cursor?.since);
  if (!historyId) throw new QmComposioError(400, "invalid_cursor", "Gmail history cursor is incomplete.");
  const historyDone = cursor?.historyDone === true;
  const mailDone = cursor?.mailDone === true;
  const history = historyDone
    ? null
    : await runCurated(identity, "GMAIL_LIST_HISTORY", {
        start_history_id: historyId,
        max_results: limit,
        page_token: typeof cursor?.historyPageToken === "string" ? cursor.historyPageToken : undefined,
      });
  // ponytail: query-based hydration avoids one tool call per history item; hydrate IDs if label-level fidelity is required.
  const mail = mailDone
    ? null
    : await runCurated(identity, "GMAIL_FETCH_EMAILS", {
        query: `after:${Math.floor(new Date(since).valueOf() / 1000)}`,
        max_results: limit,
        page_token: typeof cursor?.mailPageToken === "string" ? cursor.mailPageToken : undefined,
        include_payload: false,
      });
  const historyPageToken = history ? scalar(history, ["nextPageToken", "next_page_token"]) : null;
  const mailPageToken = mail ? scalar(mail, ["nextPageToken", "next_page_token"]) : null;
  const nextHistoryDone = historyDone || !historyPageToken;
  const nextMailDone = mailDone || !mailPageToken;
  if (!nextHistoryDone || !nextMailDone) {
    return {
      records: normalizeKnowledgeRecords("gmail", mail),
      cursor: encodeCursor({
        toolkit: "gmail",
        phase: "history",
        historyId,
        since,
        historyDone: nextHistoryDone,
        mailDone: nextMailDone,
        ...(historyPageToken ? { historyPageToken } : {}),
        ...(mailPageToken ? { mailPageToken } : {}),
      }),
      hasMore: true,
      phase: "history",
    };
  }
  const profile = await runCurated(identity, "GMAIL_GET_PROFILE", {});
  const nextHistoryId = scalar(profile, ["historyId", "history_id"]);
  if (!nextHistoryId) throw new QmComposioError(502, "missing_history_cursor", "Gmail did not return a history cursor.");
  return {
    records: normalizeKnowledgeRecords("gmail", mail),
    cursor: encodeCursor({ toolkit: "gmail", phase: "history", historyId: nextHistoryId, since: now }),
    hasMore: false,
    phase: "history",
  };
}

async function syncFathom(identity: string, cursorValue: unknown, windowStartValue: unknown, limit: number) {
  const now = new Date().toISOString();
  const cursor = decodeCursor(cursorValue);
  if (cursor && cursor.toolkit !== "fathom") throw new QmComposioError(400, "invalid_cursor", "Cursor is for another toolkit.");
  if (cursor && cursor.phase !== "initial" && cursor.phase !== "incremental") {
    throw new QmComposioError(400, "invalid_cursor", "Fathom cursor phase is invalid.");
  }
  const phase = cursor?.phase === "incremental" ? "incremental" : "initial";
  const watermark = validIso(
    cursor?.watermark ?? windowStartValue,
    phase === "initial" ? new Date(Date.now() - 30 * 86400000).toISOString() : undefined,
  );
  const cutoff = validIso(cursor?.cutoff, now);
  const pageCursor = typeof cursor?.pageCursor === "string" ? cursor.pageCursor : undefined;
  const data = await runCurated(identity, "FATHOM_LIST_MEETINGS", {
    created_after: watermark,
    created_before: cutoff,
    cursor: pageCursor,
    limit,
    include_summary: true,
    include_action_items: true,
    include_transcript: false,
  });
  const next = scalar(data, ["next_cursor", "nextCursor"]);
  return {
    records: normalizeKnowledgeRecords("fathom", data),
    cursor: encodeCursor(
      next
        ? { toolkit: "fathom", phase, watermark, cutoff, pageCursor: next }
        : { toolkit: "fathom", phase: "incremental", watermark: cutoff },
    ),
    hasMore: Boolean(next),
    phase: next ? phase : "incremental",
  };
}

export async function syncToolkit(
  identity: string,
  toolkitValue: unknown,
  cursor: unknown,
  windowStart: unknown,
  limitValue: unknown,
  capability: QmCapability,
) {
  assertScopeOperation(capability, "sync");
  const toolkit = validateToolkit(toolkitValue);
  if (toolkit !== "gmail" && toolkit !== "fathom") {
    throw new QmComposioError(400, "sync_profile_required", "V1 sync supports curated Gmail and Fathom profiles.");
  }
  const maximum = toolkit === "gmail" ? 50 : 10;
  const limit = limitValue === undefined ? maximum : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new QmComposioError(400, "invalid_limit", `Limit must be between 1 and ${maximum}.`);
  }
  return toolkit === "gmail"
    ? syncGmail(identity, cursor, windowStart, limit)
    : syncFathom(identity, cursor, windowStart, limit);
}
