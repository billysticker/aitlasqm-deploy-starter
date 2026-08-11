# Customer-owned Composio gateway

This directory is the server-side bridge between QM capabilities and the
customer's dedicated Composio project. It is included in the starter; it is not
a ChiroCandy service and contains no deployed hostname or credential.

## Security boundary

- The Composio project API key exists only as a gateway secret.
- Every connector request must include a QM capability. The gateway validates
  it against the configured customer QM core before using Composio.
- A stable, non-reversible Composio identity is derived from the QM scope using
  a customer-owned HMAC secret.
- Personal connections require a live personal scope. Shared connections
  require a QM org admin in an approved private scope.
- Sandbox tool execution is read-only. Unified Inbox sends require an explicit
  signed-in confirmation and a unique request ID.
- The supplied Fly configuration runs one gateway machine. Do not horizontally
  scale the current in-memory send-idempotency layer without adding a shared
  idempotency store.

## Local checks

```bash
npm ci
npm test
npm run build
```

## Fly deployment

Run the commands from this directory after the customer QM core exists:

```bash
fly apps create <gateway-app> --org <customer-fly-org>
fly secrets set \
  GATEWAY_PUBLIC_URL=https://<gateway-app>.fly.dev \
  QM_CORE_API_URL=https://<app-prefix>-core.fly.dev \
  QM_COMPOSIO_API_KEY=<enter-privately> \
  QM_COMPOSIO_IDENTITY_SECRET=<enter-privately> \
  QM_COMPOSIO_AUTH_CONFIGS_JSON='{}' \
  --app <gateway-app>
fly deploy --app <gateway-app>
```

Avoid passing secrets on a shared screen or leaving them in shell history. The
class manual describes safer dashboard/secret-manager entry and the acceptance
tests required before enabling teammate connections.
