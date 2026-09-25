# Starter release checklist

- [ ] `npm ci` completed from the committed lockfile.
- [ ] `npm run starter:audit` passed on the clean starter defaults.
- [ ] `npm run test:composio`, `npm run gateway:test`, and
      `npm run gateway:build` passed.
- [ ] `npm audit --omit=dev` reports zero production vulnerabilities in
      `connector-gateway/`.
- [ ] The pinned upstream web UI revision accepts all patches, its AitlasQM
      route/branding tests pass, its production dependency audit is clean, and
      its Vite production build succeeds.
- [ ] Company Brain UI is described as optional until a customer-owned knowledge
      service and grants are configured and verified.
- [ ] Native room skill examples contain only generic instructions and are
      described as opt-in, with no inherited credential grant.
- [ ] A second human reviewed all tracked files for production topology and
      internal company language.
- [ ] No `.env`, generated output, live registry image/digest, company gateway,
      private identity/voice skill, or git history from a live deployment is
      present.
- [ ] The included gateway, Composio skill/tool, and UI patches use customer
      placeholders and contain no live hostname, staff email, team ID, or app.
- [ ] Slack manifests contain fake names and the fake callback only.
- [ ] The upstream QM repository and pinned CLI version are documented.
- [x] The MIT license has been selected and added before public release.
- [ ] The new GitHub repository is marked **Template**.
- [ ] The course portal links only to this starter and the class materials.
- [ ] The PDF points to the starter URL and says `reviewed at commit <starter SHA>`.
- [ ] A tagged sanitized ZIP/release was created if no-GitHub replay access is
      required.

Do not mark this checklist complete from automated checks alone. Public release
needs a human content review.
