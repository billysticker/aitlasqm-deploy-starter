import { createHmac } from "node:crypto";

const CORE_AUD = "control-plane";
const TOOLKIT = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOOL = /^[A-Z0-9][A-Z0-9_]{2,127}$/;

export class QmComposioError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface QmCapability {
  actorId: string;
  scopeId: string;
  admin: { isAdmin: boolean; role?: string };
  privateScope: boolean;
  liveActor: boolean;
  triggered: boolean;
  exp: number;
}

interface CapabilityClaims {
  actorId?: unknown;
  scopeId?: unknown;
  aud?: unknown;
  privateScope?: unknown;
  liveActor?: unknown;
  triggered?: unknown;
  exp?: unknown;
}

function scopeKind(scopeId: string) {
  return scopeId.slice(0, scopeId.indexOf(":"));
}

function decodeClaims(token: string): CapabilityClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new QmComposioError(401, "invalid_capability", "Invalid QM capability.");
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as CapabilityClaims;
  } catch {
    throw new QmComposioError(401, "invalid_capability", "Invalid QM capability.");
  }
}

export async function validateQmCapability(
  token: string | null,
  options: {
    coreUrl?: string;
    fetchImpl?: typeof fetch;
    now?: number;
  } = {},
): Promise<QmCapability> {
  if (!token || token.length > 8192) {
    throw new QmComposioError(401, "missing_capability", "QM capability is required.");
  }

  const configuredCore = options.coreUrl ?? process.env.QM_CORE_API_URL;
  if (!configuredCore) {
    throw new QmComposioError(503, "gateway_not_configured", "QM core validation is not configured.");
  }
  const core = new URL(configuredCore);
  if (core.protocol !== "https:" || core.username || core.password || core.search || core.hash) {
    throw new QmComposioError(503, "gateway_not_configured", "QM core validation is not configured.");
  }
  core.pathname = `${core.pathname.replace(/\/$/, "")}/v1/apis`;

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(core, {
      headers: { Accept: "application/json", "x-agent-capability": token },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new QmComposioError(503, "qm_core_unavailable", "QM core validation is unavailable.", true);
  }
  if (response.status === 401 || response.status === 403) {
    throw new QmComposioError(401, "invalid_capability", "Invalid or expired QM capability.");
  }
  if (!response.ok) {
    throw new QmComposioError(503, "qm_core_unavailable", "QM core validation is unavailable.", true);
  }

  const text = await response.text();
  if (text.length > 131072) {
    throw new QmComposioError(502, "invalid_qm_response", "QM core returned an invalid response.");
  }

  let verified: { actorId?: unknown; scopeId?: unknown; admin?: { isAdmin?: unknown; role?: unknown } };
  try {
    verified = JSON.parse(text) as typeof verified;
  } catch {
    throw new QmComposioError(502, "invalid_qm_response", "QM core returned an invalid response.");
  }

  const claims = decodeClaims(token);
  const now = options.now ?? Date.now();
  const kinds = new Set(["personal", "channel", "team", "org", "group"]);
  const personalWebSession = claims.aud === undefined &&
    typeof claims.scopeId === "string" &&
    scopeKind(claims.scopeId) === "personal";
  if (
    (claims.aud !== CORE_AUD && !personalWebSession) ||
    typeof claims.actorId !== "string" ||
    typeof claims.scopeId !== "string" ||
    typeof claims.exp !== "number" ||
    now >= claims.exp ||
    verified.actorId !== claims.actorId ||
    verified.scopeId !== claims.scopeId ||
    !kinds.has(scopeKind(claims.scopeId)) ||
    claims.scopeId.endsWith(":") ||
    typeof verified.admin?.isAdmin !== "boolean"
  ) {
    throw new QmComposioError(401, "invalid_capability", "Invalid or expired QM capability.");
  }
  for (const value of [claims.privateScope, claims.liveActor, claims.triggered]) {
    if (value !== undefined && typeof value !== "boolean") {
      throw new QmComposioError(401, "invalid_capability", "Invalid QM capability.");
    }
  }

  return {
    actorId: claims.actorId,
    scopeId: claims.scopeId,
    admin: {
      isAdmin: verified.admin.isAdmin,
      ...(typeof verified.admin.role === "string" ? { role: verified.admin.role } : {}),
    },
    privateScope: personalWebSession || claims.privateScope === true,
    liveActor: personalWebSession || claims.liveActor === true,
    triggered: claims.triggered === true,
    exp: claims.exp,
  };
}

export function composioIdentity(scopeId: string, secret: string) {
  if (secret.length < 32) {
    throw new QmComposioError(503, "gateway_not_configured", "QM Composio identity secret is not configured.");
  }
  return `qm_${createHmac("sha256", secret).update(scopeId).digest("base64url")}`;
}

export type QmOperation = "connect" | "connections" | "search" | "read" | "sync" | "send";

export function assertScopeOperation(capability: QmCapability, operation: QmOperation) {
  const personal = scopeKind(capability.scopeId) === "personal";
  if (!personal && !capability.privateScope) {
    throw new QmComposioError(
      403,
      "private_scope_required",
      "Use a personal QM chat, Slack DM, or approved private QM channel.",
    );
  }
  if (operation === "connect" && (!capability.liveActor || capability.triggered)) {
    throw new QmComposioError(403, "live_actor_required", "This action requires a live teammate request.");
  }
  if (operation === "connect" && !personal && !capability.admin.isAdmin) {
    throw new QmComposioError(403, "admin_required", "Only a QM org admin may connect a shared toolkit.");
  }
  if (operation === "send" && (!personal || !capability.liveActor || capability.triggered)) {
    throw new QmComposioError(
      403,
      "live_personal_action_required",
      "Sending requires a signed-in teammate in their personal workspace.",
    );
  }
}

export function validateToolkit(value: unknown) {
  if (typeof value !== "string" || !TOOLKIT.test(value.toLowerCase())) {
    throw new QmComposioError(400, "invalid_toolkit", "A valid toolkit slug is required.");
  }
  return value.toLowerCase();
}

export function validateToolSlug(value: unknown) {
  if (typeof value !== "string" || !TOOL.test(value.toUpperCase())) {
    throw new QmComposioError(400, "invalid_tool", "A valid tool slug is required.");
  }
  return value.toUpperCase();
}

export function toolIsReadOnly(tags: readonly string[] | undefined) {
  return tags?.includes("readOnlyHint") === true && !tags.includes("destructiveHint");
}

export function assertToolPolicy(
  tool: { slug: string; tags?: string[] },
  capability: QmCapability,
) {
  assertScopeOperation(capability, "read");
  if (toolIsReadOnly(tool.tags)) return;
  throw new QmComposioError(403, "tool_not_allowed", "Only read-only tools are available.");
}

export interface KnowledgeRecord {
  toolkit: "gmail" | "fathom";
  sourceId: string;
  title: string;
  summary: string;
  actionItems: string[];
  occurredAt: string | null;
  sourcePointer: string;
}

export interface QmToolkitCard {
  slug: string;
  name: string;
  logo: string | null;
  description: string;
  connectable: boolean;
  setupRequired: boolean;
}

type JsonObject = Record<string, unknown>;

export function normalizeToolkitCatalog(
  values: JsonObject[],
  configured: Record<string, string>,
): QmToolkitCard[] {
  const oauth = new Set(["OAUTH1", "OAUTH2", "S2S_OAUTH2", "DCR_OAUTH"]);
  const credentials = new Set(["API_KEY", "BEARER_TOKEN", "BASIC", "BASIC_WITH_JWT"]);
  return values.flatMap((item) => {
    const slug = text(item.slug, 64).toLowerCase();
    if (!slug || item.noAuth === true) return [];
    const managed = Array.isArray(item.composioManagedAuthSchemes)
      ? item.composioManagedAuthSchemes.filter((value): value is string => typeof value === "string")
      : [];
    const available = Array.isArray(item.authSchemes)
      ? item.authSchemes.filter((value): value is string => typeof value === "string")
      : [];
    const hasManagedOauth = managed.some((scheme) => oauth.has(scheme));
    const hasSupportedAuth = [...managed, ...available].some(
      (scheme) => oauth.has(scheme) || credentials.has(scheme),
    );
    const hasConfiguredAuth = Boolean(configured[slug]);
    if (!hasSupportedAuth && !hasConfiguredAuth) return [];
    const meta = object(item.meta);
    const rawLogo = text(meta?.logo, 2048);
    const connectable = hasManagedOauth || hasConfiguredAuth;
    return [{
      slug,
      name: text(item.name, 120) || slug,
      logo: /^https:\/\//i.test(rawLogo) ? rawLogo : null,
      description: text(meta?.description, 280),
      connectable,
      setupRequired: !connectable,
    }];
  });
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function text(value: unknown, max: number) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, max);
  if (typeof value === "number") return String(value);
  return "";
}

function first(record: JsonObject, keys: string[], max = 800) {
  for (const key of keys) {
    const direct = text(record[key], max);
    if (direct) return direct;
    const nested = object(record[key]);
    if (nested) {
      for (const nestedKey of ["text", "content", "markdown_formatted", "value"]) {
        const found = text(nested[nestedKey], max);
        if (found) return found;
      }
    }
  }
  return "";
}

function itemsFrom(value: unknown, toolkit: "gmail" | "fathom", depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  const record = object(value);
  if (!record || depth > 4) return [];
  const keys = toolkit === "gmail" ? ["threads", "emails", "messages", "items"] : ["items", "meetings", "recordings"];
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  for (const key of ["data", "result", "response", "output"]) {
    const found = itemsFrom(record[key], toolkit, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function iso(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let raw: string | number = value;
  if (typeof raw === "string" && /^\d{12,}$/.test(raw)) raw = Number(raw);
  if (typeof raw === "number" && raw < 1e12) raw *= 1000;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function actionItems(record: JsonObject) {
  const value = record.action_items ?? record.actionItems;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (object(item) ? first(item as JsonObject, ["text", "description", "action_item"], 300) : text(item, 300)))
    .filter(Boolean)
    .slice(0, 10);
}

export function normalizeKnowledgeRecords(toolkit: "gmail" | "fathom", value: unknown): KnowledgeRecord[] {
  const unique = new Map<string, KnowledgeRecord>();
  for (const candidate of itemsFrom(value, toolkit)) {
    const record = object(candidate);
    if (!record) continue;
    const sourceId = first(
      record,
      toolkit === "gmail"
        ? ["threadId", "thread_id", "id", "messageId", "message_id"]
        : ["recording_id", "recordingId", "meeting_id", "meetingId", "id"],
      256,
    );
    if (!sourceId) continue;
    const title = first(record, toolkit === "gmail" ? ["subject", "title"] : ["title", "meeting_title", "name"], 200);
    const summary = first(record, toolkit === "gmail" ? ["snippet", "preview", "summary"] : ["summary", "meeting_summary"], 1000);
    const occurredAt = iso(
      record.internalDate ??
        record.internal_date ??
        record.created_at ??
        record.start_time ??
        record.recorded_at ??
        record.timestamp ??
        record.date,
    );
    const sourcePointer =
      first(record, ["url", "share_url", "recording_url", "permalink"], 1000) ||
      (toolkit === "gmail" ? `gmail://thread/${sourceId}` : `fathom://meeting/${sourceId}`);
    unique.set(sourceId, {
      toolkit,
      sourceId,
      title: title || (toolkit === "gmail" ? "Email thread" : "Fathom meeting"),
      summary,
      actionItems: toolkit === "fathom" ? actionItems(record) : [],
      occurredAt,
      sourcePointer,
    });
  }
  return [...unique.values()];
}

export type QmInboxSource = "gmail" | "outlook" | "slack";

export interface QmInboxConversation {
  id: string;
  source: QmInboxSource;
  threadId: string;
  channelId?: string;
  messageId?: string;
  title: string;
  participant: string;
  preview: string;
  lastAt: string | null;
  unread: boolean;
  sourceUrl?: string;
}

export interface QmInboxMessage {
  id: string;
  sender: string;
  recipients: string[];
  text: string;
  sentAt: string | null;
  outgoing: boolean;
}

function nestedList(value: unknown, paths: string[][]): JsonObject[] {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) current = object(current)?.[key];
    if (Array.isArray(current)) {
      const rows = current.map(object).filter((row): row is JsonObject => row !== null);
      if (rows.length) return rows;
    }
  }
  return [];
}

function plain(value: unknown, max = 4_000): string {
  const raw = text(value, max * 2);
  if (!raw) return "";
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function mailbox(value: unknown): string {
  const record = object(value);
  const address = object(record?.emailAddress);
  return plain(address?.name, 160) || plain(address?.address, 254);
}

function mailboxList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(mailbox).filter(Boolean).slice(0, 25);
}

function slackDate(value: unknown): string | null {
  const raw = typeof value === "string" ? Number(value.split(".")[0]) : Number.NaN;
  return Number.isFinite(raw) ? new Date(raw * 1_000).toISOString() : null;
}

export function normalizeInbox(source: QmInboxSource, value: unknown): QmInboxConversation[] {
  const rows = source === "gmail"
    ? nestedList(value, [["messages"], ["data", "messages"], ["result", "messages"]])
    : source === "outlook"
      ? nestedList(value, [["value"], ["data", "value"], ["result", "value"]])
      : nestedList(value, [
          ["messages", "matches"],
          ["data", "messages", "matches"],
          ["result", "messages", "matches"],
        ]);
  const unique = new Map<string, QmInboxConversation>();
  for (const row of rows) {
    let item: QmInboxConversation | null = null;
    if (source === "gmail") {
      const threadId = plain(row.threadId ?? row.thread_id, 256);
      const messageId = plain(row.messageId ?? row.message_id, 256);
      if (!threadId) continue;
      item = {
        id: `gmail:${threadId}`,
        source,
        threadId,
        ...(messageId ? { messageId } : {}),
        title: plain(row.subject, 240) || "Email thread",
        participant: plain(row.sender, 320),
        preview: plain(row.messageText ?? object(row.preview)?.text ?? row.preview, 320),
        lastAt: iso(row.messageTimestamp ?? row.internalDate ?? row.date),
        unread: Array.isArray(row.labelIds) && row.labelIds.includes("UNREAD"),
        ...(plain(row.display_url, 1_500) ? { sourceUrl: plain(row.display_url, 1_500) } : {}),
      };
    } else if (source === "outlook") {
      const messageId = plain(row.id, 512);
      const threadId = plain(row.conversationId, 512) || messageId;
      if (!messageId) continue;
      item = {
        id: `outlook:${threadId}`,
        source,
        threadId,
        messageId,
        title: plain(row.subject, 240) || "Email thread",
        participant: mailbox(row.from) || mailbox(row.sender),
        preview: plain(row.bodyPreview ?? object(row.body)?.content, 320),
        lastAt: iso(row.receivedDateTime ?? row.sentDateTime ?? row.createdDateTime),
        unread: row.isRead === false,
        ...(plain(row.webLink, 1_500) ? { sourceUrl: plain(row.webLink, 1_500) } : {}),
      };
    } else {
      const channel = object(row.channel);
      const channelId = plain(channel?.id, 128);
      const threadId = plain(row.thread_ts ?? row.ts, 128);
      if (!channelId || !threadId) continue;
      item = {
        id: `slack:${channelId}:${threadId}`,
        source,
        threadId,
        channelId,
        messageId: plain(row.ts, 128) || threadId,
        title: plain(channel?.name, 160) || "Slack conversation",
        participant: plain(row.username ?? row.user, 160),
        preview: plain(row.text, 320),
        lastAt: slackDate(row.latest_reply ?? row.ts),
        unread: false,
        ...(plain(row.permalink, 1_500) ? { sourceUrl: plain(row.permalink, 1_500) } : {}),
      };
    }
    const previous = unique.get(item.id);
    if (!previous || (item.lastAt ?? "") > (previous.lastAt ?? "")) unique.set(item.id, item);
  }
  return [...unique.values()].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

export function normalizeInboxThread(source: QmInboxSource, value: unknown): QmInboxMessage[] {
  const rows = source === "gmail"
    ? nestedList(value, [["messages"], ["data", "messages"], ["result", "messages"]])
    : source === "outlook"
      ? nestedList(value, [["value"], ["data", "value"], ["result", "value"]])
      : nestedList(value, [["messages"], ["data", "messages"], ["result", "messages"]]);
  return rows.flatMap((row): QmInboxMessage[] => {
    if (source === "gmail") {
      const id = plain(row.messageId ?? row.message_id, 256);
      if (!id) return [];
      const labels = Array.isArray(row.labelIds) ? row.labelIds : [];
      return [{
        id,
        sender: plain(row.sender, 320),
        recipients: plain(row.to, 1_000).split(/[,;]/).map((part) => part.trim()).filter(Boolean).slice(0, 25),
        text: plain(row.messageText ?? object(row.preview)?.text ?? row.preview, 12_000),
        sentAt: iso(row.messageTimestamp ?? row.internalDate ?? row.date),
        outgoing: labels.includes("SENT"),
      }];
    }
    if (source === "outlook") {
      const id = plain(row.id, 512);
      if (!id) return [];
      return [{
        id,
        sender: mailbox(row.from) || mailbox(row.sender),
        recipients: mailboxList(row.toRecipients),
        text: plain(object(row.body)?.content ?? row.bodyPreview, 12_000),
        sentAt: iso(row.sentDateTime ?? row.receivedDateTime ?? row.createdDateTime),
        outgoing: plain(row.parentFolderId, 160).toLowerCase().includes("sent"),
      }];
    }
    const id = plain(row.ts, 128);
    if (!id) return [];
    return [{
      id,
      sender: plain(row.username ?? row.user, 160),
      recipients: [],
      text: plain(row.text, 12_000),
      sentAt: slackDate(row.ts),
      outgoing: false,
    }];
  }).sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
}

export function encodeCursor(value: JsonObject) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor(value: unknown): JsonObject | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new QmComposioError(400, "invalid_cursor", "Invalid sync cursor.");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!object(decoded)) throw new Error();
    return decoded;
  } catch {
    throw new QmComposioError(400, "invalid_cursor", "Invalid sync cursor.");
  }
}
