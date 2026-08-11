import { NextRequest, NextResponse } from "next/server";
import {
  connectToolkit,
  executeTool,
  listInbox,
  listConnections,
  listToolkits,
  readInboxThread,
  searchTools,
  sendInboxMessage,
  syncToolkit,
} from "@/lib/qm-composio";
import {
  QmComposioError,
  composioIdentity,
  validateQmCapability,
} from "@/lib/qm-composio-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new QmComposioError(415, "json_required", "Content-Type must be application/json.");
  }
  const text = await request.text();
  if (!text || text.length > 262144) {
    throw new QmComposioError(413, "invalid_body", "Request body is empty or too large.");
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new QmComposioError(400, "invalid_json", "Request body must be a JSON object.");
  }
}

function callbackUrl() {
  const value = process.env.GATEWAY_PUBLIC_URL;
  if (!value) throw new QmComposioError(503, "gateway_not_configured", "Gateway public URL is not configured.");
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new QmComposioError(503, "gateway_not_configured", "Gateway public URL must use HTTPS.");
  }
  url.pathname = "/api/qm/composio/callback";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function context(request: NextRequest) {
  const capability = await validateQmCapability(request.headers.get("x-agent-capability"));
  const identity = composioIdentity(capability.scopeId, process.env.QM_COMPOSIO_IDENTITY_SECRET ?? "");
  return { capability, identity };
}

function failure(error: unknown) {
  if (error instanceof QmComposioError) {
    return response({ error: error.code, message: error.message, retryable: error.retryable }, error.status);
  }
  return response({ error: "gateway_error", message: "Connector gateway request failed.", retryable: false }, 500);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action === "callback") {
    return new NextResponse(
      "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Connector updated</title></head><body><main><h1>Connector updated</h1><p>You can close this window and return to QM.</p></main></body></html>",
      {
        status: 200,
        headers: {
          ...NO_STORE,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  if (action !== "connections" && action !== "catalog") {
    return response({ error: "not_found", message: "Not found." }, 404);
  }
  try {
    const { capability, identity } = await context(request);
    if (action === "catalog") return response(await listToolkits(capability));
    return response({ connections: await listConnections(identity, capability) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    if (!new Set(["connect", "search", "execute", "sync", "inbox", "thread", "send"]).has(action)) {
      return response({ error: "not_found", message: "Not found." }, 404);
    }
    const input = await body(request);
    const { capability, identity } = await context(request);
    if (action === "connect") {
      return response(await connectToolkit(identity, input.toolkit, capability, callbackUrl()));
    }
    if (action === "search") {
      return response(await searchTools(identity, input.query, input.toolkit, capability));
    }
    if (action === "execute") {
      const result = await executeTool(
        identity,
        input.toolSlug,
        input.input,
        input.mode,
        capability,
      );
      return response(result.body, result.httpStatus);
    }
    if (action === "inbox") {
      return response(await listInbox(identity, input.sources, input.query, capability));
    }
    if (action === "thread") {
      return response(await readInboxThread(identity, input.source, input.threadId, input.channelId, capability));
    }
    if (action === "send") {
      return response(await sendInboxMessage(identity, input, capability));
    }
    return response(await syncToolkit(identity, input.toolkit, input.cursor, input.windowStart, input.limit, capability));
  } catch (error) {
    return failure(error);
  }
}
