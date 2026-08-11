import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "aitlasqm-customer-connector-gateway",
      configured: Boolean(
        process.env.GATEWAY_PUBLIC_URL &&
          process.env.QM_CORE_API_URL &&
          process.env.QM_COMPOSIO_API_KEY &&
          process.env.QM_COMPOSIO_IDENTITY_SECRET,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
