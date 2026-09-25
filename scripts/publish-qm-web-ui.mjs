import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = "5a5cb51260b13000dda5d890d40c877c88d87555";
const source = join(root, ".generated", `qm-web-ui-${revision.slice(0, 12)}`);
const configPath = join(root, "qm.config.jsonc");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status ?? 1);
  }
  return capture ? `${result.stdout || ""}\n${result.stderr || ""}` : "";
}

const config = readFileSync(configPath, "utf8");
const prefix = config.match(/"appPrefix"\s*:\s*"([^"]+)"/)?.[1];
if (!prefix || prefix.includes("replace-me")) {
  console.error("Replace appPrefix in qm.config.jsonc before publishing the web UI.");
  process.exit(1);
}

const app = option("--app") || `${prefix}-web-ui`;
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(app)) {
  console.error("--app must be a valid customer-owned Fly app name.");
  process.exit(1);
}

if (!existsSync(source)) run(process.execPath, [join(root, "scripts", "prepare-qm-web-ui.mjs"), source]);

const tag = `aitlasqm-${revision.slice(0, 12)}`;
const taggedImage = `registry.fly.io/${app}:${tag}`;
run("flyctl", ["auth", "docker"]);
run("docker", [
  "buildx", "build",
  "--platform", "linux/amd64",
  "--push",
  "--tag", taggedImage,
  "--file", join(source, "deploy", "web-ui", "Dockerfile"),
  source,
]);

const inspection = run("docker", ["buildx", "imagetools", "inspect", taggedImage], root, true);
const digest = inspection.match(/Digest:\s*(sha256:[a-f0-9]{64})/i)?.[1]?.toLowerCase();
if (!digest) {
  console.error("The image was pushed, but its immutable digest could not be resolved. Do not deploy a mutable tag.");
  process.exit(1);
}

const immutableImage = `registry.fly.io/${app}@${digest}`;
let updated = config;
if (/"imageOverrides"\s*:/.test(updated)) {
  updated = updated.replace(
    /("imageOverrides"\s*:\s*\{[\s\S]*?"web-ui"\s*:\s*)"[^"]+"/,
    `$1"${immutableImage}"`,
  );
} else {
  updated = updated.replace(
    /(\s*"services"\s*:\s*\[[^\]]+\],)/,
    `$1\n\n  // Customer-built AitlasQM web UI with Connections and Unified Inbox.\n  "imageOverrides": {\n    "web-ui": "${immutableImage}"\n  },`,
  );
}
if (updated === config) {
  console.error("Could not update qm.config.jsonc with the immutable web UI image.");
  process.exit(1);
}
writeFileSync(configPath, updated, "utf8");
console.log(`Pinned ${immutableImage} in qm.config.jsonc.`);
console.log("Review the diff, rerun the customized starter audit, then run qm plan before deployment.");
