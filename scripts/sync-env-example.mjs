import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = fileURLToPath(import.meta.resolve("@yc-software/qm/contract"));
const qmSource = dirname(contractPath);
const [{ loadConfigAt }, { renderEnvExample }] = await Promise.all([
  import(pathToFileURL(join(qmSource, "config.js"))),
  import(pathToFileURL(join(qmSource, "secrets.js"))),
]);

const expected = `${renderEnvExample(loadConfigAt(join(root, "qm.config.jsonc")).config).trimEnd()}\n`;
const target = join(root, ".env.example");

if (process.argv.includes("--write")) {
  writeFileSync(target, expected, "utf8");
  console.log("Updated .env.example from the pinned QM CLI and current config.");
} else if (readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== expected.replaceAll("\r\n", "\n")) {
  console.error(".env.example is stale; run npm run env:sync.");
  process.exitCode = 1;
}
