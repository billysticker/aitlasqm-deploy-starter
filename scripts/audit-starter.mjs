import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ""));
const requireComplete = process.argv.includes("--require-complete");
const requireCustomized = requireComplete || process.argv.includes("--require-customized");
const ignoredDirectories = new Set([".git", ".generated", "node_modules"]);
const binaryExtensions = new Set([".docx", ".gif", ".ico", ".jpg", ".jpeg", ".pdf", ".png", ".webp", ".zip"]);

const requiredFiles = [
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "CLASS-NOTE.md",
  "CUSTOMER-WORKSHEET.md",
  "LICENSE",
  "README.md",
  "RELEASE-CHECKLIST.md",
  "deployment.md",
  "package-lock.json",
  "package.json",
  "qm.config.jsonc",
  "slack-app-manifest.yml",
  "slack-sso-manifest.yml",
  "connector-gateway/.env.example",
  "connector-gateway/Dockerfile",
  "connector-gateway/README.md",
  "connector-gateway/app/api/qm/composio/[action]/route.ts",
  "connector-gateway/lib/qm-composio-policy.ts",
  "connector-gateway/lib/qm-composio.ts",
  "connector-gateway/package-lock.json",
  "connector-gateway/package.json",
  "patches/qm-web-ui-v0.1.4/10-unified-inbox-and-receipts.patch",
  "sandbox/Dockerfile",
  "sandbox/skills/aitlasqm-composio/SKILL.md",
  "sandbox/skills/aitlasqm-composio/scripts/composio",
  "sandbox/tools/composio/composio",
  "sandbox/tools/composio/tool.json",
  "test/composio-client.test.mjs",
  "sandbox/skills/greet/SKILL.md",
  "sandbox/tools/example-tool/tool.json"
];

const forbidden = [
  ["Slack bot token", /xoxb-[A-Za-z0-9-]{10,}/],
  ["Slack app token", /xapp-[A-Za-z0-9-]{10,}/],
  ["OpenRouter key", /sk-or-v1-[A-Za-z0-9_-]{16,}/],
  ["GitHub token", /gh[oprsu]_[A-Za-z0-9]{20,}/],
  ["Fly token", /(?:FlyV1|fo_)[A-Za-z0-9._-]{16,}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["ChiroCandy portal hostname", /chirocandy-portal\.fly\.dev/i],
  ["ChiroCandy core hostname", /chirocandy-core\.fly\.dev/i],
  ["live Aitlas gateway hostname", /aitlasagent\.dev/i],
  ["ChiroCandy private registry image", /registry\.fly\.io\/chirocandy-/i],
  ["ChiroCandy Slack team ID", /T01E8EV4NJ1/],
  ["ChiroCandy staff email", /(?:billy|ahmad|andrew)@chirocandy\.com/i]
];

const placeholders = [
  ["replace-me", /replace-me/i],
  ["fake admin email", /admin@example\.com/i],
  ["fake Slack team ID", /T0000000000/],
  ["fake company name", /ExampleCo/i]
];
const customerFiles = new Set([
  "qm.config.jsonc",
  "sandbox/tools/composio/tool.json",
  "slack-app-manifest.yml",
  "slack-sso-manifest.yml"
]);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (!binaryExtensions.has(extname(entry).toLowerCase())) files.push(path);
  }
  return files;
}

const findings = [];

for (const required of requiredFiles) {
  if (!existsSync(join(root, required))) findings.push(`${required}: missing required starter file`);
}

if (existsSync(join(root, ".env"))) findings.push(".env: secret-bearing file must not exist in the starter");

for (const path of walk(root)) {
  const name = relative(root, path).replaceAll("\\", "/");
  const content = readFileSync(path, "utf8");
  if (name !== "scripts/audit-starter.mjs") {
    for (const [label, pattern] of forbidden) {
      if (pattern.test(content)) findings.push(`${name}: contains ${label}`);
    }
  }
  if (requireCustomized && customerFiles.has(name)) {
    for (const [label, pattern] of placeholders) {
      if (pattern.test(content)) findings.push(`${name}: still contains ${label}`);
    }
  }
}

const config = readFileSync(join(root, "qm.config.jsonc"), "utf8");
const gatewayMatches = [...config.matchAll(/"AITLAS_COMPOSIO_GATEWAY_URL"\s*:\s*"https:\/\/([^/"\s]+)\/api\/qm\/composio"/g)];
if (gatewayMatches.length !== 2) {
  findings.push("qm.config.jsonc: web-ui and sandbox must use the customer gateway path");
}
if (requireCustomized && gatewayMatches.length === 2) {
  const hosts = new Set(gatewayMatches.map((match) => match[1].toLowerCase()));
  if (hosts.size !== 1) findings.push("qm.config.jsonc: web-ui and sandbox gateway hosts do not match");
  const tool = JSON.parse(readFileSync(join(root, "sandbox", "tools", "composio", "tool.json"), "utf8"));
  const expectedHost = [...hosts][0];
  if (!Array.isArray(tool.egress) || tool.egress.length !== 1 || tool.egress[0]?.toLowerCase() !== expectedHost) {
    findings.push("sandbox/tools/composio/tool.json: egress must exactly match the configured customer gateway host");
  }
  if (requireComplete && !/"imageOverrides"\s*:/.test(config)) {
    findings.push("qm.config.jsonc: customer-built web-ui image is not pinned; run npm run web-ui:publish");
  }
}

if (findings.length) {
  console.error(`Starter audit failed with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  const mode = requireComplete ? "deployment-complete" : requireCustomized ? "customer-customized" : "sanitized-template";
  console.log(`Starter audit passed (${mode} mode).`);
}
