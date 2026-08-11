import assert from "node:assert/strict";
import test from "node:test";
import {
  QmComposioError,
  assertScopeOperation,
  assertToolPolicy,
  composioIdentity,
  normalizeInbox,
  normalizeInboxThread,
  normalizeToolkitCatalog,
  normalizeKnowledgeRecords,
  validateQmCapability,
} from "../lib/qm-composio-policy.ts";

const now = Date.now();
process.env.QM_CORE_API_URL = "https://customer-core.example";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (claims) => `${b64({ alg: "HS256" })}.${b64(claims)}.signature`;
const claims = {
  actorId: "person:alice",
  scopeId: "personal:alice",
  aud: "control-plane",
  exp: now + 60_000,
  liveActor: true,
  privateScope: true,
};
const verified = (overrides = {}) =>
  new Response(JSON.stringify({ actorId: claims.actorId, scopeId: claims.scopeId, admin: { isAdmin: false }, ...overrides }));

test("QM capability, scope, tool, identity, and compact-record boundary", async () => {
  const capability = await validateQmCapability(token(claims), { fetchImpl: async () => verified(), now });
  assert.equal(capability.scopeId, claims.scopeId);
  const webCapability = await validateQmCapability(token({ ...claims, aud: undefined, liveActor: undefined }), {
    fetchImpl: async () => verified(),
    now,
  });
  assert.equal(webCapability.liveActor, true);
  assert.equal(webCapability.privateScope, true);
  await assert.rejects(
    validateQmCapability(token({ ...claims, aud: undefined, scopeId: "channel:private" }), {
      fetchImpl: async () => verified({ scopeId: "channel:private" }),
      now,
    }),
    (error) => error instanceof QmComposioError && error.code === "invalid_capability",
  );
  await assert.rejects(validateQmCapability(null), /capability is required/);
  await assert.rejects(
    validateQmCapability(token(claims), { fetchImpl: async () => new Response("unauthorized", { status: 401 }), now }),
    (error) => error instanceof QmComposioError && error.code === "invalid_capability",
  );
  await assert.rejects(
    validateQmCapability(token({ ...claims, exp: now - 1 }), { fetchImpl: async () => verified(), now }),
    (error) => error instanceof QmComposioError && error.code === "invalid_capability",
  );
  await assert.rejects(
    validateQmCapability(token(claims), {
      fetchImpl: async () => verified({ scopeId: "personal:bob" }),
      now,
    }),
    (error) => error instanceof QmComposioError && error.code === "invalid_capability",
  );

  const secret = "s".repeat(32);
  assert.equal(composioIdentity(claims.scopeId, secret), composioIdentity(claims.scopeId, secret));
  assert.notEqual(composioIdentity(claims.scopeId, secret), composioIdentity("personal:bob", secret));
  assert.notEqual(composioIdentity("channel:private-a", secret), composioIdentity("channel:private-b", secret));

  assert.doesNotThrow(() => assertScopeOperation(capability, "connect"));
  assert.throws(
    () =>
      assertScopeOperation(
        { ...capability, scopeId: "channel:private", admin: { isAdmin: false } },
        "connect",
      ),
    /org admin/,
  );
  assert.doesNotThrow(() =>
    assertScopeOperation(
      { ...capability, scopeId: "channel:private", admin: { isAdmin: true } },
      "connect",
    ),
  );
  assert.throws(
    () => assertScopeOperation({ ...capability, scopeId: "channel:public", privateScope: false }, "read"),
    /private QM channel/,
  );
  assert.doesNotThrow(() => assertScopeOperation(capability, "send"));
  assert.throws(
    () => assertScopeOperation({ ...capability, triggered: true }, "send"),
    /signed-in teammate/,
  );

  assert.doesNotThrow(() => assertToolPolicy({ slug: "GMAIL_FETCH_EMAILS", tags: ["readOnlyHint"] }, capability));
  assert.throws(
    () => assertToolPolicy({ slug: "GMAIL_DELETE_MESSAGE", tags: ["destructiveHint"] }, capability),
    /read-only tools/,
  );

  const records = normalizeKnowledgeRecords("fathom", {
    items: [
      {
        recording_id: "meeting-1",
        title: "Weekly review",
        summary: { markdown_formatted: "Three compact decisions" },
        action_items: [{ description: "Follow up" }],
        transcript: "must never be copied",
        created_at: "2026-08-01T12:00:00Z",
      },
    ],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].summary, "Three compact decisions");
  assert.ok(!JSON.stringify(records).includes("must never be copied"));

  const catalog = normalizeToolkitCatalog(
    [
      {
        slug: "gmail",
        name: "Gmail",
        meta: { logo: "https://cdn.example/gmail.svg", description: "  Work email  " },
        authSchemes: ["OAUTH2"],
        composioManagedAuthSchemes: ["OAUTH2"],
      },
      {
        slug: "fathom",
        name: "Fathom",
        meta: { logo: "javascript:alert(1)" },
        authSchemes: ["API_KEY"],
      },
      { slug: "public", name: "Public", noAuth: true },
    ],
    { fathom: "ac_fathom" },
  );
  assert.deepEqual(catalog.map(({ slug, connectable }) => [slug, connectable]), [
    ["gmail", true],
    ["fathom", true],
  ]);
  assert.equal(catalog[1].logo, null);

  const inbox = [
    ...normalizeInbox("gmail", {
      messages: [{ threadId: "g-1", messageId: "gm-1", subject: "Move meeting", sender: "Client <client@example.com>", messageText: "Can we move it?", messageTimestamp: "2026-08-05T10:00:00Z", labelIds: ["UNREAD"] }],
    }),
    ...normalizeInbox("outlook", {
      value: [{ id: "o-1", conversationId: "oc-1", subject: "Coverage", bodyPreview: "Who is covering?", receivedDateTime: "2026-08-05T11:00:00Z", isRead: false, from: { emailAddress: { name: "Teammate", address: "teammate@example.com" } } }],
    }),
    ...normalizeInbox("slack", {
      messages: { matches: [{ ts: "1785927600.000100", text: "Quick handoff", user: "U1", channel: { id: "D1", name: "Private channel" } }] },
    }),
  ];
  assert.deepEqual(inbox.map((row) => row.source), ["gmail", "outlook", "slack"]);
  assert.equal(inbox[0].unread, true);
  assert.equal(inbox[1].participant, "Teammate");
  assert.equal(inbox[2].channelId, "D1");

  const thread = normalizeInboxThread("outlook", {
    value: [{ id: "o-1", body: { content: "<p>Hello &amp; welcome</p>" }, sentDateTime: "2026-08-05T11:00:00Z", from: { emailAddress: { address: "client@example.com" } }, toRecipients: [{ emailAddress: { address: "rep@example.com" } }] }],
  });
  assert.equal(thread[0].text, "Hello & welcome");
  assert.deepEqual(thread[0].recipients, ["rep@example.com"]);
});
