# QM teaching deployment

This repository is a sanitized customer-owned QM deployment template. It is not
a live deployment and must never be pointed at ChiroCandy accounts or resources.

## Rules

1. Keep secrets only in `.env` or the customer's secret manager. Never commit,
   print, or paste secret values into documentation, issues, or chat.
2. Replace all starter markers from `CUSTOMER-WORKSHEET.md` before planning a
   deployment.
3. Run `npm run starter:audit -- --require-customized` and `npm exec qm -- check`
   after config or sandbox changes. Before `qm up`, also run
   `npm run starter:audit -- --require-complete` to require the customer web UI
   image pin and aligned connector egress.
4. Treat `qm plan` as a preview. Obtain the customer's explicit approval of the
   provider identity, region, resources, and expected billing before `qm up`.
5. The included connector gateway, sandbox client, and web UI patches must stay
   customer-configurable. Never insert a live company's host, image, reviewer,
   Composio project, identity secret, or another deployment's voice/skills.
6. If a production value is discovered, remove it from every tracked file,
   rotate it if it was a secret, and rerun the audit.

## Repository shape

- `qm.config.jsonc` is the deployment contract.
- `.env.example` documents secret names; `.env` holds values and is ignored.
- `deployment.md` is the operator workflow.
- `slack-*-manifest.yml` are fake-name templates and must be rendered/reviewed
  for the customer's final URL and Slack names.
- `sandbox/` contains a generic scoped Composio client plus teaching examples.
- `connector-gateway/` is a deployable customer-owned gateway; its secrets live
  only in the customer's Fly secret store.
- `patches/` and `assets/` reproduce the AitlasQM Connections and Unified Inbox
  web surface from reviewed upstream QM source. The active patch series is
  `patches/qm-web-ui-v0.1.12/`; older patches are historical only.
- `room-skills/` holds opt-in native room examples; it is not an automatic
  sandbox skill import.
- `docs/COMPANY-BRAIN-ADOPTION.md` documents the safe integration boundary.
  The private ChiroCandy Brain service is not part of this public template.

QM runtime source belongs upstream at https://github.com/yc-software/qm. Do not
vendor or fork the runtime into this deployment repository.
