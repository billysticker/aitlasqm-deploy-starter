# Specialist room examples

These are customer-editable examples for **native QM room skills**. They are not
installed automatically by `qm up`. After creating private Slack channels and
connecting the QM app, an administrator should open each matching room in QM,
create its skill in the Skills editor, and paste the appropriate example. Review
the skill, its members, tools, credentials, and model allowance before use.

| Example | Purpose | Required setup |
| --- | --- | --- |
| `image-design/SKILL.md` | Draft and revise branded images | An approved image provider and a credential capability granted only to that room |
| `landing-page-design/SKILL.md` | Build responsive page drafts and review files | Approved brand assets and a browser for visual QA |

The room supplies scope. The skill supplies the method. A skill's text cannot
grant a credential, widen room membership, or approve a business action. Use a
different room and skill for each mission; adapt wording, providers, and review
roles to the customer's own policies. Keep secrets in the provider or QM's
credential store, never in the skill text or Git.

For Slack, mention the configured bot in the room and continue revisions in the
same thread. In QM web, open that room context and start a new chat. Room
conversations and files remain subject to QM's current scope and sharing rules.

These examples are derived from the workflow structure used in ChiroCandy's
private deployment. They intentionally contain no ChiroCandy room IDs, account
details, client briefs, production URLs, or approval names. They are examples,
not proof that a customer's provider or publishing connection is configured.
