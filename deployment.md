# Deploy a complete customer-owned AitlasQM instance

This runbook covers core QM, isolated sandboxes, the customer Composio gateway,
Connections, Unified Inbox, Slack, and acceptance. Run commands from the
customer's private repository unless a step explicitly says otherwise.

## 1. Confirm ownership and cost approval

The customer must own GitHub, Fly.io, Sprites, Slack, model-provider, Composio,
DNS, billing, recovery, and secret-manager access. Complete
`CUSTOMER-WORKSHEET.md` without writing secret values into it.

Before billable creation, identify the customer approver and review expected Fly,
model, Composio, storage, and domain costs. Do not reuse any live company's app,
URL, image, workspace, API key, OAuth configuration, or connected account.

## 2. Customize the tracked customer values

Replace the starter markers in:

- `qm.config.jsonc` - org, portal, Fly, storage, reviewer, and gateway values;
- `sandbox/tools/composio/tool.json` - exactly the customer gateway hostname;
- `slack-app-manifest.yml` and `slack-sso-manifest.yml` - customer names and URLs.

The two `AITLAS_COMPOSIO_GATEWAY_URL` values must be identical and end with
`/api/qm/composio`. The tool descriptor's single `egress` host must match that
URL's hostname exactly.

```bash
npm ci
npm run gateway:install
npm run starter:audit -- --require-customized
npm exec qm -- check
npm run conformance
npm run test:composio
npm run gateway:test
npm run gateway:build
```

These commands are local. Fix every failure before using a cloud account.

## 3. Prepare secrets privately

Copy `.env.example` to the ignored root `.env` and use `npm exec qm -- setup .`
to collect QM values. Confirm `git check-ignore .env` prints `.env` before
entering any credential.

The root QM secret set includes:

- `ADMIN_GRANTS=<verified-work-email>:org_admin`;
- the selected model-provider API key;
- independent QM capability, connector, signing, session, and skill secrets;
- Fly/Sprites credentials;
- Slack OIDC and bot credentials when those surfaces are enabled.

Do not add `QM_COMPOSIO_API_KEY` or `QM_COMPOSIO_IDENTITY_SECRET` to the root
`.env` or a Sprite. Those belong only in the separate gateway's Fly secrets.

## 4. Create the customer Fly apps

Verify the authenticated human and organization before each creation:

```bash
fly auth whoami
fly orgs list
fly apps create <sandbox-app> --org <customer-fly-org>
fly apps create <app-prefix>-web-ui --org <customer-fly-org>
fly apps create <gateway-app> --org <customer-fly-org>
```

The web UI app is created early so its customer-owned registry can receive the
custom image before `qm up`. If an app already exists, stop and confirm ownership
instead of adopting it by name.

## 5. Publish and pin the AitlasQM web UI

The patch set is applied to upstream QM commit
`5a5cb51260b13000dda5d890d40c877c88d87555`. It adds personal Connections,
Unified Inbox, reviewed memory suggestions, and a Brain Map UI that needs a
separate customer-owned knowledge service. The template copies no live
deployment image or knowledge database.

```bash
npm run web-ui:prepare
npm run web-ui:publish -- --app <app-prefix>-web-ui
git diff -- qm.config.jsonc
```

`web-ui:publish` authenticates Docker to the customer's Fly registry, builds for
Linux AMD64, pushes the image, resolves its immutable digest, and writes only
that customer image reference into `qm.config.jsonc`.

Now run the final tracked-file gate:

```bash
npm run starter:audit -- --require-complete
npm exec qm -- check
```

## 6. Publish the customer sandbox and deploy core QM

```bash
npm exec qm -- slack render
npm exec qm -- sandbox publish
npm exec qm -- secrets push
npm exec qm -- plan
```

Review the plan with the customer approver. Confirm organization, region, app
names, storage, portal URL, sandbox image, and web UI image all belong to the
customer. Only after approval:

```bash
npm exec qm -- up --yes
npm exec qm -- doctor
npm exec qm -- check --live
npm exec qm -- outputs --json
```

Open the portal, sign in as a normal customer user, receive one real model
answer, and independently verify an isolated sandbox proof file.

## 7. Create the customer's Composio project

In the customer's Composio organization:

1. Create a dedicated project named `<company-slug>-qm`.
2. Enable only approved launch toolkits.
3. Create managed OAuth auth configurations where available.
4. For API-key toolkits such as some Fathom setups, create the matching enabled
   auth configuration and record its `ac_...` identifier without recording the
   API key in the worksheet.
5. Create the project API key and place it directly into the gateway's Fly
   secret entry flow.

## 8. Deploy the included gateway

Generate the identity secret locally and store it immediately in the customer
password manager:

```bash
openssl rand -hex 32
```

From `connector-gateway/`, set these Fly secrets without committing them:

```text
GATEWAY_PUBLIC_URL=https://<gateway-app>.fly.dev
QM_CORE_API_URL=https://<app-prefix>-core.fly.dev
QM_COMPOSIO_API_KEY=<customer-project-key>
QM_COMPOSIO_IDENTITY_SECRET=<independent-32-byte-secret>
QM_COMPOSIO_AUTH_CONFIGS_JSON={"fathom":"ac_customer-owned-id"}
```

Then deploy and verify:

```bash
cd connector-gateway
npm ci
npm test
npm run build
fly deploy --app <gateway-app>
curl https://<gateway-app>.fly.dev/healthz
cd ..
```

The health response must say `configured: true`. A request to
`/api/qm/composio/connections` without `x-agent-capability` must return 401.
Never weaken that check to make setup easier.

Redeploy QM after the gateway is live:

```bash
npm exec qm -- sandbox publish
npm exec qm -- plan
npm exec qm -- up --yes
npm exec qm -- check --live
```

## 9. Connect and prove personal isolation

Use test accounts containing no patient health information.

1. Sign in as User A and open their personal QM web workspace or Slack DM.
2. Select **Add your own connections**, choose an approved app, and open the
   returned Connect Link.
3. Complete the provider authorization screen and return to QM.
4. Confirm the connection is active and run one harmless read.
5. Open **Unified inbox** and confirm only User A's connected sources appear.
6. Sign in as User B. User A's connection, messages, and synchronized knowledge
   must not appear or execute.
7. For a shared connection, require an org admin and an approved private QM
   scope; prove it is not visible from another scope.

The sandbox command path is also available:

```bash
composio connect gmail
composio connections
composio search "recent email" --toolkit gmail
composio read GMAIL_FETCH_EMAILS --json '{}'
```

Do not claim success from a Connect Link alone. Save evidence of OAuth completion,
active status, safe read, and User B isolation.

## 10. Unified Inbox write gate

Inbox reads use the signed personal capability. A send/reply is allowed only
after the signed-in user reviews the exact recipient and message, confirms it in
the UI, and submits a unique request ID. The sandbox CLI remains read-only.

Run a harmless test message only to a controlled test recipient. If duplicate
sends, wrong identity, or scope leakage appears, disable the gateway route and
stop acceptance.

## 11. Configure Slack

Use `slack-sso-manifest.yml` for portal sign-in and `slack-app-manifest.yml` for
the agent bot. They are separate apps. Render the manifests, inspect callback
URLs/scopes, create them in the customer workspace, and store secrets privately.

Acceptance requires a normal user to sign in and receive a real response to one
DM and one approved-channel mention. Explicitly prevent duplicate routing if
another bot is installed in the same channel.

## 12. Final acceptance and handoff

Record named evidence for ownership, local checks, web UI digest, gateway release,
real model answer, sandbox isolation, User A OAuth/read, User B isolation, Inbox
behavior, Slack, idempotent second `qm up`, monitoring, backup, and rollback.

Routine diagnostics:

```bash
npm exec qm -- status
npm exec qm -- doctor
npm exec qm -- check --live
npm exec qm -- logs core
npm exec qm -- outputs
```

Record the previous sandbox digest before publishing. Use
`npm exec qm -- rollback --to <verified-digest>` for a failed sandbox release.
Disable affected gateway routes/auth configurations before retrying connector
incidents. `qm down` stops services; it does not authorize deletion of databases,
buckets, volumes, connected accounts, or audit evidence.
