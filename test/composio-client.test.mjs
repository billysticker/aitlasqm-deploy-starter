import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  apiRequest,
  executeCommand,
  openKnowledge,
  searchKnowledge,
  syncConnector,
} = require("../sandbox/tools/composio/composio");

test("gateway commands and SQLite sync are scoped, compact, and cursor-safe", async () => {
  let syncCalls = 0;
  let failSync = false;
  const server = createServer(async (request, response) => {
    if (request.headers["x-agent-capability"] !== "test-capability") {
      response
        .writeHead(401, { "Content-Type": "application/json", Connection: "close" })
        .end('{"message":"unauthorized"}');
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const action = new URL(request.url, "http://localhost").pathname.split("/").pop();
    const send = (status, value) =>
      response
        .writeHead(status, { "Content-Type": "application/json", Connection: "close" })
        .end(JSON.stringify(value));

    if (action === "connect") return send(200, { toolkit: body.toolkit, connectUrl: "https://connect.example/test" });
    if (action === "connections") return send(200, { connections: [{ toolkit: "gmail", active: true }] });
    if (action === "search") return send(200, { tools: [{ slug: "GMAIL_FETCH_EMAILS", toolkit: "gmail" }] });
    if (action === "execute") {
      return send(200, { status: "succeeded", data: { ok: true } });
    }
    if (action === "sync") {
      if (failSync) return send(503, { message: "temporarily unavailable", retryable: true });
      syncCalls += 1;
      return send(200, {
        records: [
          {
            toolkit: body.toolkit,
            sourceId: "source-1",
            title: "Weekly review",
            summary: `Compact summary ${syncCalls}`,
            actionItems: ["Follow up"],
            occurredAt: "2026-08-01T12:00:00.000Z",
            sourcePointer: "fathom://meeting/source-1",
          },
        ],
        cursor: `cursor-${syncCalls}`,
        hasMore: false,
        phase: "incremental",
      });
    }
    if (action === "bad") {
      response.writeHead(200, { "Content-Type": "text/plain", Connection: "close" }).end("not-json");
      return;
    }
    send(404, { message: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const workspace = mkdtempSync(join(tmpdir(), "qm-composio-"));
  const env = {
    NODE_ENV: "test",
    AGENT_API_TOKEN: "test-capability",
    AITLASQM_WORKSPACE: workspace,
    AITLAS_COMPOSIO_GATEWAY_URL: `http://127.0.0.1:${address.port}/api/qm/composio`,
  };
  const run = async (args) => {
    const output = [];
    await executeCommand(args, { env, write: (value) => output.push(value) });
    return JSON.parse(output.at(-1));
  };

  try {
    assert.equal((await run(["connect", "gmail"])).connectUrl, "https://connect.example/test");
    assert.equal((await run(["connections"])).connections[0].active, true);
    assert.equal((await run(["search", "recent email"])).tools[0].slug, "GMAIL_FETCH_EMAILS");
    assert.equal((await run(["read", "GMAIL_FETCH_EMAILS", "--json", "{}"])).data.ok, true);

    assert.equal((await syncConnector("fathom", env)).stored, 1);
    assert.equal((await syncConnector("fathom", env)).stored, 1);
    const db = openKnowledge(env);
    assert.equal(db.prepare("SELECT count(*) AS count FROM knowledge_items").get().count, 1);
    const before = db.prepare("SELECT cursor FROM sync_state WHERE toolkit = 'fathom'").get().cursor;
    db.close();
    assert.equal(searchKnowledge("weekly", env).length, 1);

    failSync = true;
    await assert.rejects(syncConnector("fathom", env), /temporarily unavailable/);
    const afterDb = openKnowledge(env);
    assert.equal(afterDb.prepare("SELECT cursor FROM sync_state WHERE toolkit = 'fathom'").get().cursor, before);
    afterDb.close();

    await assert.rejects(apiRequest("bad", {}, env), /malformed JSON/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(workspace, { recursive: true, force: true });
  }
});
