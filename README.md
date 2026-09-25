# AitlasQM deploy starter

This public template installs a customer-owned AitlasQM stack with isolated QM
sandboxes, Slack, a scoped Composio connector gateway, personal app connections,
and the AitlasQM Connections and Unified Inbox web UI.

The template now pins `@yc-software/qm@0.1.12`. Its reviewed UI patches are
based on the matching upstream source revision. Customer-owned specialist room
examples are in [`room-skills/`](./room-skills/README.md); publish them to the
appropriate native QM room only after setting its members, tools, and review
rules. [Company Brain adoption](./docs/COMPANY-BRAIN-ADOPTION.md) explains the
scoped knowledge contract and the separate service it requires.

It contains no ChiroCandy production URL, Fly organization, Slack workspace ID,
credential, Composio project, private registry image, or customer data. Every
student deploys into accounts owned by their own company.

> Class instruction: select **Use this template**, create a new private
> repository, complete the worksheet, and never deploy from the shared class
> copy.

## What is included

| Path | Purpose |
|---|---|
| `qm.config.jsonc` | Customer QM/Fly/Slack deployment contract |
| `sandbox/` | Isolated sandbox layer, scoped Composio client, skills, and examples |
| `connector-gateway/` | Deployable customer-owned Composio gateway |
| `patches/` and `assets/` | Reproducible AitlasQM Connections and Unified Inbox web UI |
| `scripts/prepare-qm-web-ui.mjs` | Applies the reviewed patches to pinned upstream QM source |
| `scripts/publish-qm-web-ui.mjs` | Builds, pushes, and pins the customer's immutable web UI image |
| `docs/` | Current class setup manual |
| `room-skills/` | Editable image and landing-page room examples; opt-in, not auto-installed |

QM runtime source remains upstream at
[yc-software/qm](https://github.com/yc-software/qm). This repository contains
only the customer deployment overlay and reviewed extension packages.

## Start here

1. Open [CUSTOMER-WORKSHEET.md](./CUSTOMER-WORKSHEET.md) and choose customer
   owners, slugs, URLs, app names, reviewers, and approved connector toolkits.
2. Replace every `replace-me`, `admin@example.com`, `T0000000000`, and
   `ExampleCo` value. The gateway hostname must match in `qm.config.jsonc` and
   `sandbox/tools/composio/tool.json`. Set `QM_BRAND_MARK_URL` in web UI and
   admin to the customer's own public icon URL.
3. Install Node 24+, Git, Docker Buildx, Fly CLI, Sprites CLI, and OpenSSL.
4. Run the local gates:

   ```bash
   npm ci
   npm run env:check
   npm run gateway:install
   npm run starter:audit -- --require-customized
   npm exec qm -- check
   npm run conformance
   npm run test:composio
   npm run gateway:test
   npm run gateway:build
   ```

5. Follow [deployment.md](./deployment.md). It walks through the initial QM
   deployment, customer Composio project, gateway deployment, custom web UI,
   sandbox publication, Slack apps, OAuth connection, and isolation proof.

The printable guide is [docs/AitlasQM-Setup-Manual.pdf](./docs/AitlasQM-Setup-Manual.pdf).

## Connector security model

- Composio credentials remain only in the customer gateway secret store.
- QM sends a short-lived scope capability; the gateway validates it against the
  customer QM core before every connector action.
- Personal scopes derive separate non-reversible Composio identities, so one
  teammate cannot reuse another teammate's connection.
- Sandbox tool execution exposes read-only Composio actions. Unified Inbox sends
  require a signed-in user, exact confirmation, and a unique request ID.
- Personal connections begin in a personal web workspace or Slack DM. Shared
  connections require a QM org admin in an approved private scope.

## Validation is not production acceptance

Local checks prove repository structure, policy behavior, compilation, and
static conformance. They do not prove the customer's Fly deployment, DNS,
Composio OAuth, Slack routing, model billing, or second-user isolation.

Production acceptance requires evidence for:

- customer-owned account and billing boundaries;
- real portal sign-in and one provider-backed model answer;
- isolated sandbox proof for two users;
- a real Connect Link, active connection, and harmless read;
- User B being unable to see or use User A's connection;
- Unified Inbox read and explicitly confirmed send, if enabled;
- Slack mention/DM behavior, rollback information, and named owners.

## Costs

The template is MIT-licensed. Each customer pays for their own hosting, model
usage, storage, connectors, and maintenance. Estimate costs from that customer's
planned services and provider prices before deploying; this repository does
not promise a fixed operating price or savings against another product.

The starter is released under the [MIT License](./LICENSE).
