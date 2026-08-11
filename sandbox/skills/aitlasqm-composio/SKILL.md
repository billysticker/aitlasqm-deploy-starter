---
name: aitlasqm-composio
description: Connect and use teammate or private-channel apps through the scoped AitlasQM Composio gateway. Use for Gmail, Fathom, and new connector requests from QM web or Slack.
---

# AitlasQM Composio

Run Composio with `node ./skills/aitlasqm-composio/scripts/composio` in QM web and Slack. Do not probe PATH or require a `COMPOSIO_API_KEY`; the client is synchronized with this skill and calls the scoped gateway. QM's current capability determines the identity and scope; never invent, pass, or ask for a user ID, Composio key, OAuth token, or account alias.

## Connect

- A teammate saying “connect my Gmail/Fathom” in a DM or personal QM chat: run `node ./skills/aitlasqm-composio/scripts/composio connect <toolkit>` and return the Connect URL for that teammate to open.
- A personal connection request in any channel: do not connect there. Ask the teammate to DM AitlasQM or use their personal QM chat.
- A shared/team connector: only an org admin may start it, and only from the designated private QM channel. The resulting connector belongs to that private scope, so members of that same scope may use it.
- Fathom needs the administrator-preconfigured API-key auth config. If the gateway says `admin_setup_required`, report that exact setup need; do not fake a connection.
- Keep existing native QM connectors working, but use Composio by default for new teammate connectors.

After the human approves the Connect URL, run `node ./skills/aitlasqm-composio/scripts/composio connections`. Do not claim success until it reports the toolkit active.
## User-facing replies

- Do not mention Composio, the gateway, QM internals, hosting, commands, or the route taken unless the user explicitly asks for technical details.
- On success say: `Open this link to connect your <app>:` followed by the Connect URL and nothing about the underlying provider.
- For reads and knowledge searches, return the requested result directly. Do not preface it with which tool or system was used.
- Translate `admin_setup_required` to: `This app needs a one-time administrator setup before you can connect it.`
- Translate other internal failures into one plain-language next step; never paste raw errors, internal URLs, or credentials.

## Use

1. Discover a safe tool: `node ./skills/aitlasqm-composio/scripts/composio search "<need>"`.
2. Read: `node ./skills/aitlasqm-composio/scripts/composio read <TOOL_SLUG> --json '<input>'`.

The gateway refuses unmarked reads and all mutations, including drafts, sends, deletes, publishing, and calendar invitations. Never route around that refusal.

## Knowledge sync

Once Gmail or Fathom is active:

1. Run `node ./skills/aitlasqm-composio/scripts/composio sync <toolkit>` repeatedly while `hasMore` is true. The first pass covers 30 days.
2. List the current scope's Crons. If that toolkit does not already have an incremental sync, create exactly one native QM Cron for every three hours with the instruction: `Run node ./skills/aitlasqm-composio/scripts/composio sync <toolkit>. Report only stored count, hasMore, and cursorStatus. If hasMore is true, continue on the next run.` Never create a duplicate schedule.
3. Save one short durable QM Memory pointer: `Connector knowledge is stored locally; search it with node ./skills/aitlasqm-composio/scripts/composio knowledge search "<query>".`

Sync stores compact summaries, action items, timestamps, and source pointers in the current scope's `.aitlasqm/knowledge.sqlite`. Never copy raw batches, complete email bodies, attachments, or transcripts into chat or Memory. Search with `node ./skills/aitlasqm-composio/scripts/composio knowledge search "<query>"` and return only the compact matches.

## Rules

A connector “rule” in v1 is either a connector-backed instruction or a recurring QM Cron instruction. Event/webhook automation and autonomous external writes are not available in v1.
