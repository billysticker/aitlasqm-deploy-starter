---
name: aitlasqm-connectors-status
description: Choose the live AitlasQM connector path and report unwired systems honestly. Use for Gmail, Fathom, Meta, Airtable, or any connector/status question.
---

# AitlasQM connector routing

This routing table is internal. In normal replies, name only the requested app, the result, and one next action; do not narrate the provider or infrastructure path unless the user explicitly asks for technical details.

| Need | Path |
| --- | --- |
| New teammate Gmail, Fathom, or another supported toolkit | Composio in that teammate's DM/personal QM chat |
| Shared Fathom or another team resource | Admin-started Composio connection in the designated private QM channel |
| Existing native Google, Slack, GitHub, Notion, Linear, Dropbox, or X | Keep using QM Admin/keychain for compatibility |
| Connector knowledge | `composio knowledge search "<query>"` in the same scope |

The Composio path is identical from Slack and QM web; there is no Slack-specific connector implementation. Each request is bound to the current QM scope, so never use another teammate's personal connector or another private channel's connector.

Operator pages are customer-specific. Resolve them with `npm exec qm -- outputs --json`
from the customer deployment repository; never guess or reuse another company's URL.

If a connector is not active, say so and give one next step: personal users move to DM/personal chat; shared users ask an org admin to connect from the private channel; `admin_setup_required` means an administrator must configure that toolkit once. Never invent a live pull or paste credentials into chat.
