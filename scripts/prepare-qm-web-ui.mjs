import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = "7f2c916360f1797a8ff2a77ce2ce40c5fabab087";
const destination = resolve(process.argv[2] || join(root, ".generated", `qm-web-ui-${revision.slice(0, 12)}`));
const patchDir = join(root, "patches", "qm-web-ui-v0.1.4");
const assetDir = join(root, "assets", "qm-web-ui");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (existsSync(destination)) {
  console.error(`Refusing to overwrite ${destination}`);
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
run("git", ["clone", "--filter=blob:none", "--no-checkout", "https://github.com/yc-software/qm.git", destination]);
run("git", ["checkout", "--detach", revision], destination);

for (const name of readdirSync(patchDir).filter((name) => name.endsWith(".patch")).sort()) {
  const file = join(patchDir, name);
  run("git", ["apply", "--check", "--recount", file], destination);
  run("git", ["apply", "--recount", file], destination);
}

const publicDir = join(destination, "plugins", "web-ui", "public");
mkdirSync(publicDir, { recursive: true });
for (const name of readdirSync(assetDir)) copyFileSync(join(assetDir, name), join(publicDir, name));

console.log(`Prepared customer web UI source at ${destination}`);
