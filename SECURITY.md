# Security

This template contains generic connector and UI implementation code, safe
placeholders, and secret names. It must never contain credential values, a live
company hostname/account ID, connected-account data, or a private image pin.

The customer Composio API key and identity HMAC secret belong only in the
customer gateway's Fly secret store. The sandbox and web UI receive only the
customer gateway URL and short-lived QM capabilities.

Connector safety requirements:

- validate every capability against the configured customer QM core;
- derive separate stable identities from the exact QM scope;
- allow personal connections only from live personal scopes;
- require an org admin for a shared connection in an approved private scope;
- keep sandbox tool execution read-only;
- require exact signed-in confirmation for Unified Inbox sends;
- never store patient health information, raw OAuth tokens, or Composio keys in
  QM chat, Memory, Sprites, documentation, or git.

If a credential or private production value is committed:

1. remove it from the public surface and preserve evidence needed for response;
2. rotate or revoke the value in the owning customer account;
3. audit forks, releases, course ZIP files, issues, and logs for copies;
4. rerun all three audit modes, connector tests, gateway build, and a human
   review before republishing.

Do not report an exposed secret in a public issue. Contact the repository owner
through the private security channel listed on its GitHub Security page.
