# Customer deployment worksheet

Record identifiers and owners here, never secret values. Store credentials only
in the customer's ignored `.env` file or provider secret manager.

## Ownership

| Decision | Customer answer |
|---|---|
| Legal/company name | |
| GitHub repository owner | |
| Technical operator email | |
| Billing owner | |
| Emergency/rollback owner | |

## Deployment identity

| Decision | Customer answer |
|---|---|
| Lowercase organization slug | |
| Globally unique Fly app prefix | |
| Fly organization | |
| Fly region | |
| Public portal URL | |
| Sandbox app name | |
| Object-storage bucket name | |
| Customer connector gateway app | |
| Customer connector gateway URL | |
| Customer web UI image app | |

## Access and Slack

| Decision | Customer answer |
|---|---|
| First administrator work email | |
| Allowed email(s) or domain | |
| Slack workspace name | |
| Slack workspace team ID | |
| Bot display name | |
| SSO app display name | |
| Slack bot required now? | Yes / No |

## Model and data boundary

| Decision | Customer answer |
|---|---|
| Model provider and account owner | OpenRouter / other |
| Approved model or provider default | |
| Monthly budget/alert owner | |
| Data allowed in the agent | |
| Data explicitly prohibited | |
| Human approval required before external writes | |

## Connected apps and sandbox boundary

| Decision | Customer answer |
|---|---|
| Composio organization/project owner | |
| Composio project slug | |
| Approved launch toolkits | |
| Toolkits needing admin auth configuration | |
| Personal connection scopes | Personal web / Slack DM |
| Approved private shared scope | |
| Connector request reviewer email | |
| Unified Inbox send enabled? | Yes / No |
| Controlled recipient for send acceptance | |
| Gateway monitoring/incident owner | |

## Acceptance owner

The named customer operator must approve the `qm plan` preview and personally
verify portal sign-in, one real web response, sandbox isolation, a live personal
OAuth connection, second-user connector isolation, and one Slack response if
Slack is enabled. A successful command, build, Connect Link, or HTTP response
alone is not customer acceptance.
