/**
 * Scaffold a new ACKS module repo from skeleton/.
 *
 * Usage:
 *   node bin/new-module.mjs <module-id> --title "Feature Name" [--desc "One-line description."] [--key acksXy]
 *                           [--pushed | --from <rev> | --worktree]
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
 *
 * The module is built from the files of this tree as they stand, so an edit
 * that is not committed is in the module, whoever made it. The run then has
 * `sync-toolchain.mjs --check` compare the module with canon, and its last
 * line is the verdict: `level:`, `not level:` or `not checked:`. A module
 * that was started and could not be finished ends `not checked:` as well. The
 * canon flags are that script's and are passed to it. With none the canon is
 * `origin/main` as the check fetches it, which is what the module's own CI
 * will compare it with, and the check lists what this tree holds that the
 * branch does not. A fresh checkout is its commit, so CI asks for
 * `--worktree`.
 *
 * Exit status: 0 where the module was made and is level with canon; 1 where
 * it was made and is not; 2 where nothing was made (an argument the script
 * does not know, a target that exists), where a module was started and not
 * finished, or where it was made and the check could not run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { COPY_DIRS } from "../manifest.mjs";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const SKELETON = path.join(TEMPLATE_ROOT, "skeleton");
const SYNC = path.join(TEMPLATE_ROOT, "bin", "sync-toolchain.mjs");
const EXIT = { notLevel: 1, unable: 2 };

function refuse(problem) {
  console.error(`new-module: ${problem}`);
  console.error(
    'usage: node bin/new-module.mjs <module-id> --title "Feature Name" [--desc "One-liner."] [--key acksXy] [--pushed | --from <rev> | --worktree]',
  );
  process.exit(EXIT.unable);
}

/**
 * The command line with every argument accounted for. One the script does not
 * know is refused before anything is written: read past, a mistyped
 * `--worktree` is a module compared with some other canon.
 */
function parseArgs(argv) {
  const values = { "--title": [], "--desc": [], "--description": [], "--key": [], "--from": [] };
  const canon = [];
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pushed" || arg === "--worktree") canon.push([arg]);
    else if (Object.hasOwn(values, arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) refuse(`${arg} takes a value`);
      values[arg].push(value);
      if (arg === "--from") canon.push([arg, value]);
    } else if (arg.startsWith("--")) refuse(`unknown argument ${arg}`);
    else ids.push(arg);
  }
  if (ids.length !== 1) refuse(ids.length ? `one module id, and ${ids.length} were given: ${ids.join(", ")}` : "a module id is needed");
  if (canon.length > 1) refuse("--pushed, --from and --worktree each name the canon the module is compared with; give one");
  return {
    id: ids[0],
    title: values["--title"].at(-1),
    desc: [...values["--desc"], ...values["--description"]].at(-1) ?? "",
    key: values["--key"].at(-1),
    canon: canon.flat(),
  };
}

const { id, title, desc, key: moduleKey, canon } = parseArgs(process.argv.slice(2));

if (!title) refuse("--title is needed");
if (!/^[a-z][a-z0-9-]*$/.test(id)) refuse(`module id "${id}" must be lowercase kebab-case`);
if (!id.startsWith("acks-")) console.warn(`WARN: family convention is an "acks-" prefix (got "${id}")`);

const target = path.join(path.dirname(TEMPLATE_ROOT), id);
if (fs.existsSync(target)) {
  console.error(`${target} already exists — refusing to overwrite`);
  process.exit(EXIT.unable);
}

const vars = {
  MODULE_ID: id,
  MODULE_TITLE: title,
  MODULE_DESCRIPTION: desc,
  // The scaffold directory is `id`. Live repos diverge (id acks-extras lives in
  // foundryvtt-acks-extras), but sync-toolchain re-renders CLAUDE.md from the
  // real directory basename on every sync, so this self-corrects after a move.
  REPO_DIR: id,
  LANG_PREFIX: id.toUpperCase(),
  MODULE_KEY: moduleKey ?? "acks" + id.replace(/^acks-?/, "").split("-").map((w) => w[0] ?? "").join(""),
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

// COPY_DIRS trees (skills, rules, hooks) are canon at the template root, not
// in skeleton/ — copy them verbatim, no placeholder rendering.
function copyVerbatim(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyVerbatim(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

const git = (...a) => execFileSync("git", ["-C", target, ...a], { stdio: "inherit" });

// From here the target exists. A step that throws leaves a module that is not
// finished and that nothing compared. Left to node that run exits 1, which is
// this script's status for a module that was made and differs.
try {
  copyRendered(SKELETON, target);
  for (const relDir of COPY_DIRS) {
    copyVerbatim(path.join(TEMPLATE_ROOT, relDir), path.join(target, relDir));
  }

  // Seed the LOCAL-ONLY rules-extract folder (licensed book text lives outside
  // every repo — see acks-rules/README.md).
  const rulesDir = path.join(path.dirname(TEMPLATE_ROOT), "acks-rules", id);
  if (!fs.existsSync(path.join(rulesDir, "RULES.md"))) {
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, "RULES.md"),
      `# ${title} — Canonical Rules Extract (LOCAL-ONLY, never commit)\n\nCite book, chapter, and section for every rule; record table data in full.\n\n## §1 <first rule area>\n\n*(fill in during design)*\n`,
    );
  }

  git("init", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", `Scaffold ${id} from acks-module-template`);
} catch (error) {
  console.error(`new-module: ${error.message}`);
  console.log(`not checked: ${target} was started and not finished; remove it before running this again`);
  process.exit(EXIT.unable);
}

console.log(`
Scaffolded ${target} from this tree as it stands (branch main, first commit done).

Next steps:
  cd ${target}
  npm install
  npm run validate
  # when ready to publish (deliberate manual step):
  gh repo create NocTempre/${id} --public --source . --push
  # Foundry dev install:
  powershell -Command "New-Item -ItemType Junction -Path \\"$env:LOCALAPPDATA\\FoundryVTT\\Data\\modules\\${id}\\" -Target \\"${target}\\""
`);

// The sync says what canon is and what differs from it, so its check is run
// and not repeated here. Every line of it but a file read level is shown, and
// the verdict comes last: a reader of the last line alone must not take a
// module that differs, or one nobody compared, for a level one.
const check = spawnSync(process.execPath, [SYNC, "--check", ...canon, "--repo-path", target], { encoding: "utf8" });
const said = `${check.stdout ?? ""}${check.stderr ?? ""}`.split("\n").filter((line) => line.trim() && !/^ {2}ok\s/u.test(line) && !line.startsWith("=== "));
if (said.length) console.log(said.join("\n"));
// The check's own `done:` line is what says it read the module through. Its
// exit status alone does not: node exits 1 for a script it cannot load, as the
// check does for drift, and 0 for a file that is empty.
const through = said.some((line) => line.startsWith("done: "));
const level = through && check.status === 0;
const differs = through && check.status === 1;
if (level) console.log(`level: ${target} holds every file the sync writes as that canon has it`);
else if (differs) {
  console.log(
    `not level: ${target} was made and differs from that canon in the path(s) above; \`node "${SYNC}" --apply --repo-path "${target}"\` writes the pushed branch over them`,
  );
} else console.log(`not checked: ${target} was made, and the check against canon could not run`);
process.exitCode = level ? 0 : differs ? EXIT.notLevel : EXIT.unable;
