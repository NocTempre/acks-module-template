/**
 * Scaffold a new ACKS module repo from skeleton/.
 *
 * Usage:
 *   node bin/new-module.mjs <module-id> --title "Feature Name" --desc "One-line description." [--key acksXy]
 *
 * --key sets the short module key that prefixes pack document _ids (default:
 * "acks" + the initials of the id words after acks-, e.g. acks-equipment ->
 * "ackse"). Keep it short — it must leave room inside 16-char document ids.
 *
 * Creates C:\Proj\<module-id> (a sibling of this template repo), renders all
 * {{PLACEHOLDER}} values, initialises git on branch `main`, and makes the
 * first commit. Creating the GitHub repo and pushing is a deliberate manual
 * step afterwards:
 *   gh repo create NocTempre/<module-id> --public --source . --push
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const SKELETON = path.join(TEMPLATE_ROOT, "skeleton");

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const title = opt("title");
const desc = opt("desc") ?? opt("description") ?? "";

if (!id || !title) {
  console.error('Usage: node bin/new-module.mjs <module-id> --title "Feature Name" [--desc "One-liner."]');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`module id "${id}" must be lowercase kebab-case`);
  process.exit(1);
}
if (!id.startsWith("acks-")) console.warn(`WARN: family convention is an "acks-" prefix (got "${id}")`);

const target = path.join(path.dirname(TEMPLATE_ROOT), id);
if (fs.existsSync(target)) {
  console.error(`${target} already exists — refusing to overwrite`);
  process.exit(1);
}

const vars = {
  MODULE_ID: id,
  MODULE_TITLE: title,
  MODULE_DESCRIPTION: desc,
  LANG_PREFIX: id.toUpperCase(),
  MODULE_KEY: opt("key") ?? "acks" + id.replace(/^acks-?/, "").split("-").map((w) => w[0] ?? "").join(""),
  MODULE_NAMESPACE: id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()),
};
const render = (text) =>
  Object.entries(vars).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

function copyRendered(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyRendered(src, dest);
    else fs.writeFileSync(dest, render(fs.readFileSync(src, "utf8")));
  }
}

copyRendered(SKELETON, target);

const git = (...a) => execFileSync("git", ["-C", target, ...a], { stdio: "inherit" });
git("init", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", `Scaffold ${id} from acks-module-template`);

console.log(`
Scaffolded ${target} (branch main, first commit done).

Next steps:
  cd ${target}
  npm install
  npm run validate
  # when ready to publish (deliberate manual step):
  gh repo create NocTempre/${id} --public --source . --push
  # Foundry dev install:
  powershell -Command "New-Item -ItemType Junction -Path \\"$env:LOCALAPPDATA\\FoundryVTT\\Data\\modules\\${id}\\" -Target \\"${target}\\""
`);
