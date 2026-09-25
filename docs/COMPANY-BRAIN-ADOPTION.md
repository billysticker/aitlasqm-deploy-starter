# Company knowledge and Brain adoption

QM already provides scoped memory, files, room context, and sharing controls.
Those features are in the upstream runtime. A connected **Company Brain** adds
cross-source retrieval and a relationship map, but it requires a separate
customer-owned knowledge service and an explicit access contract. This public
starter does **not** include or deploy ChiroCandy's Brain service.

## Reusable boundary

```text
Slack or QM web
  -> verified QM person + room scope
  -> short-lived capability
  -> customer-owned gateway
  -> customer-owned knowledge service
  -> source-filtered results and source links
```

The knowledge service is derived knowledge. A customer's CRM, project system,
or other operational application remains authoritative for clients, staff,
assignments, approvals, and financial records. A graph link does not grant
access to the linked source.

For each customer, define separate personal, company, restricted-leadership,
and client or project sources. Bind a private shared room only to approved
company or client sources. Derive access from the signed QM scope and the
customer's current role/assignment authority. Never accept a user ID, source
ID, or grant supplied by an agent prompt as proof of access.

Index compact, attributed facts: title, summary, action item, timestamp, and
source pointer. Keep raw email bodies, complete meeting transcripts,
attachments, credentials, and private conversation history out of the index
unless a separate, reviewed policy explicitly authorizes them. Show the
original source and timestamp with an answer; state gaps and conflicts.

Private knowledge may be suggested for wider use, but promotion needs the
owner's consent, a reviewer decision, and a durable write receipt. Keep those
three steps separate. A failed or missing receipt is not success. External
actions still follow QM and customer approval rules.

## Before enabling a customer Brain

1. Select the customer's knowledge provider and dedicated database; record
   ownership, data region, retention, backup, and deletion rules.
2. Define the source classes, current role/assignment authority, and exact
   ingestion consent for each connected account.
3. Configure the gateway to validate a fresh QM capability on every request.
   Keep signing and identity secrets in the customer's secret manager.
4. Test two users and two clients: each person sees only their own personal
   source and explicitly granted shared sources. Verify rejected access and
   source-linked answers.
5. Test reviewer-gated private-to-company promotion, failed writes, duplicate
   submissions, and readback receipts before enabling background sync.
6. Only then enable scheduled ingestion and the relationship-map UI.

The private ChiroCandy implementation includes company-specific database
roles, AI-OS grants, migrations, and operational memory contracts. Those files
must be refactored and independently tested before a portable Brain service
can be released. Copying its current directory into this template would bind
new deployments to ChiroCandy-specific authority rules.
