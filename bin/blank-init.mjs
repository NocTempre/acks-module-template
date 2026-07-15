/**
 * One-shot initialiser shipped inside blank-template/ as INIT.mjs.
 * Standalone on purpose (node stdlib only, no imports from the template repo)
 * because the folder gets copied away before this runs.
 *
 * Usage, after copying blank-template/ to C:\Proj\<your-module-id>:
 *   node INIT.mjs --title "Feature Name" [--desc "One-line description."] [--key acksXy]
 *
 * --key sets the short module key prefixing pack document _ids (default:
 * "acks" + initials of the id words after acks-).
 *
 * Derives the module id from the folder name, renders every {{PLACEHOLDER}},
 * initialises git on branch `main`, makes the first commit, and deletes
 * itself.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(url.fileURLToPath(import.meta.url));
const id = path.basename(ROOT);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const title = opt("title");
const desc = opt("desc") ?? opt("description") ?? "";

if (id === "blank-template") {
  console.error("Copy this folder to C:\\Proj\\<your-module-id> and rename it first — the folder name becomes the module id.");
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`folder name "${id}" must be lowercase kebab-case (it becomes the module id)`);
  process.exit(1);
}
if (!title) {
  console.error('Usage: node INIT.mjs --title "Feature Name" [--desc "One-liner."]');
  process.exit(1);
}
if (!id.startsWith("acks-")) console.warn(`WARN: family convention is an "acks-" prefix (got "${id}")`);
if (fs.existsSync(path.join(ROOT, ".git"))) {
  console.error("this folder is already a git repo — INIT.mjs is for a fresh copy only");
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

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full !== url.fileURLToPath(import.meta.url)) {
      fs.writeFileSync(full, render(fs.readFileSync(full, "utf8")));
    }
  }
})(ROOT);

fs.rmSync(url.fileURLToPath(import.meta.url));
fs.rmSync(path.join(ROOT, "HOW-TO-USE.md"), { force: true });

const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { stdio: "inherit" });
git("init", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", `Scaffold ${id} from acks-module-template (blank-template copy)`);

console.log(`
Initialised ${id} (branch main, first commit done; INIT.mjs removed).

Next steps:
  npm install
  npm run validate
  # when ready to publish (deliberate manual step):
  gh repo create NocTempre/${id} --public --source . --push
`);
