/**
 * Sync the canonical toolchain files into the existing ACKS module repos.
 *
 * Usage:
 *   node bin/sync-toolchain.mjs [--check]            report drift (default; exit 1 if any)
 *   node bin/sync-toolchain.mjs --apply              write canon into each target
 *   node bin/sync-toolchain.mjs --apply --force      write the paths --apply holds, too
 *   node bin/sync-toolchain.mjs --repo acks-monsters limit to named repo(s) (repeatable)
 *   node bin/sync-toolchain.mjs --repo-path <path>   target an explicit repo path (repeatable;
 *                                                    used by the CI toolchain-check workflow)
 *   --pushed | --from <rev> | --worktree             the canon --check reads (below)
 *
 * What syncs is declared in manifest.mjs. Skills (and any other COPY_DIRS
 * tree) sync from the template repo root into each module repo's own
 * `.claude/` — project-scoped, committed, CI-gated. There is no user-level
 * install: a `~/.claude/skills/acks-*` copy is a drift hazard that once
 * silently clobbered newer text, and any found should be deleted.
 *
 * Canon is a commit of this repository, except under `--worktree`:
 *   --pushed      `origin/main` as this run fetches it, which is what a
 *                 module's CI checks out and compares the module with. Where
 *                 the fetch fails, `--check` reads the branch as last fetched
 *                 and says so.
 *   --from <rev>  the commit named. Nothing is fetched.
 *   --worktree    the files of this tree as they stand, uncommitted edits
 *                 included. A fresh checkout is its commit, so CI asks for
 *                 this one.
 * `--apply` writes `--pushed` and takes no other canon, so what it writes is
 * on the branch already and a module is never synced ahead of the template.
 * `--check` reads `--pushed` too where no flag names a canon.
 *
 * A commit is exported whole into a scratch directory and the sync runs from
 * the export: the engine, the manifest and the files are that commit's. An
 * edit in this tree takes no part, whoever made it, and the run lists every
 * path of canon the tree holds that it did not read.
 *
 * `--apply` destroys no bytes that git cannot give back. Where a path it
 * would write or remove is modified, staged, untracked or ignored, the repo
 * is held: nothing is written in it and the paths are named. `--force` writes
 * them too. An uncommitted path the sync does not write is not looked at.
 *
 * Exit status: 0 where every target was read and is level with canon (after
 * `--apply`, was made level); 1 on drift, or on a repo `--apply` held; 2
 * where the run could not do what was asked — a target that is missing or is
 * not a module repo, a canon that cannot be resolved, an argument the script
 * does not know.
 *
 * After --apply, run `npm run build:packs && npm run validate` in each repo
 * and commit (compiled packs are gitignored build output — only
 * `packs/_source` can show a diff, and only when content really changed).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const SKELETON = path.join(TEMPLATE_ROOT, "skeleton");

/** The branch every module's CI checks out, and the ref this repository keeps it under. */
const REMOTE = "origin";
const BRANCH = "main";
const TIP = `refs/remotes/${REMOTE}/${BRANCH}`;
/** The canon `--check` reads where no flag names one. */
const CHECK_CANON = "pushed";
/** How long a fetch of the branch may take. One that runs past it has failed. */
const FETCH_MS = 60_000;
/**
 * Set by a run for the engine it starts from an export: the export's directory
 * and the canon's name. A process that finds it naming any other directory is
 * not that engine, and reads the variable as absent.
 */
const EXPORT_ENV = "ACKS_SYNC_EXPORT";
const EXIT = { drift: 1, unable: 2 };

/** A run that cannot do what was asked. Thrown, so that a scratch directory is removed on the way out. */
class Unable extends Error {}

function usage(problem) {
  console.error(`sync-toolchain: ${problem}`);
  console.error(
    "usage: node bin/sync-toolchain.mjs [--check [--pushed | --from <rev> | --worktree] | --apply [--force]] [--repo <name>]... [--repo-path <path>]...",
  );
  process.exit(EXIT.unable);
}

/**
 * The command line with every argument accounted for. One the script does not
 * know is refused: read past, a mistyped `--apply` is a check and a mistyped
 * `--repo-path` is the default targets.
 */
function parseArgs(argv) {
  const flags = new Set();
  const values = { "--repo": [], "--repo-path": [], "--from": [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["--check", "--apply", "--force", "--pushed", "--worktree"].includes(arg)) flags.add(arg);
    else if (Object.hasOwn(values, arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) usage(`${arg} takes a value`);
      values[arg].push(value);
    } else usage(`unknown argument ${arg}`);
  }
  const apply = flags.has("--apply");
  if (apply && flags.has("--check")) usage("--check and --apply are two runs");
  if (flags.has("--force") && !apply) usage("--force goes with --apply");
  const named = [flags.has("--pushed") && "pushed", flags.has("--worktree") && "worktree", values["--from"].length && "rev"].filter(Boolean);
  if (named.length > 1 || values["--from"].length > 1) usage("--pushed, --from and --worktree each name the canon; give one");
  if (apply && named.length && named[0] !== "pushed") usage(`--apply writes ${REMOTE}/${BRANCH} as this run fetches it, and takes no other canon`);
  return { apply, force: flags.has("--force"), canon: named[0] ?? null, from: values["--from"][0], repos: values["--repo"], repoPaths: values["--repo-path"] };
}

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply;
const FORCE = args.force;

const norm = (text) => text.replaceAll("\r\n", "\n");
const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
// Repo JSON can arrive BOM'd (Windows PowerShell's `utf8` writes one) and
// JSON.parse rejects the BOM — a parse crash here would abort the whole run
// and mask every check after it, so all repo JSON goes through these.
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const readJson = (file) => JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
const skeletonText = (relFile) => fs.readFileSync(path.join(SKELETON, relFile), "utf8");

// Every git call below names its repository with `-C`. A caller's own
// repository variables (a hook sets them) would point each one at the caller's.
// The repositories are ones other sessions stage and commit in, so no call
// here takes a lock it can do without: a status that paused to rewrite an
// index would be what made a peer's `git add` fail.
const GIT_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"].includes(key.toUpperCase())),
  ),
  GIT_OPTIONAL_LOCKS: "0",
};
const gitIn = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: GIT_ENV });
const git = (...a) => gitIn(TEMPLATE_ROOT, ...a);

/** Whether two paths are one directory, through links, short names and letter case. */
function samePath(a, b) {
  const real = (p) => fs.realpathSync.native(p);
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  return fold(real(a)) === fold(real(b));
}

function renderVars(moduleJson, repoDir) {
  // LANG_PREFIX renders the repo's ACTUAL lang root(s), read from lang/en.json:
  // the merged repos deliberately keep one root per pre-merge feature, so an
  // id-derived prefix would name a root no key uses. Fresh scaffolds (no lang
  // file yet) keep the id-derived default.
  let langPrefix = (moduleJson.id ?? "").toUpperCase();
  try {
    const lang = readJson(path.join(repoDir, "lang", "en.json"));
    const roots = [...new Set(Object.keys(lang).map((k) => k.split(".")[0]))].filter((r) => r !== "TYPES");
    if (roots.length) langPrefix = roots.join(", ");
  } catch {
    /* keep the default */
  }
  // The working-dir / GitHub repo name. NOT always the module id — the
  // merged repos are foundryvtt-acks-extras (id acks-extras), the same
  // split the system repo uses — so junction targets and release URLs
  // must render from this, never from MODULE_ID. Read it from module.json's
  // `url` (canon: https://github.com/NocTempre/<repo>), never from the
  // directory being synced: a git worktree names itself after nothing, and a
  // basename-of-cwd render once rewrote a repo's own name to its worktree
  // directory in the committed CLAUDE.md.
  const repoFromUrl = (moduleJson.url ?? "").match(/github\.com\/[^/]+\/([^/]+?)(?:\.git)?\/?$/u)?.[1];
  return {
    MODULE_ID: moduleJson.id,
    MODULE_TITLE: (moduleJson.title ?? moduleJson.id).replace(/^ACKS II\s+—\s+/u, ""),
    MODULE_DESCRIPTION: moduleJson.description ?? "",
    LANG_PREFIX: langPrefix,
    REPO_DIR: repoFromUrl ?? path.basename(repoDir),
  };
}
const render = (text, vars) =>
  Object.entries(vars).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

/*
 * A repo is planned whole before a byte of it is written. A step is one file:
 * `found` is what the sync met there (ok, drift, missing, extra, custom),
 * `text` is what the file is to hold and `remove` says it is to go. A step
 * with neither is level already, or is one the sync does not write.
 */

function planFile(repoDir, relFile, canonicalText) {
  const current = readIf(path.join(repoDir, relFile));
  if (current !== null && norm(current) === norm(canonicalText)) return { file: relFile, found: "ok" };
  return { file: relFile, found: current === null ? "missing" : "drift", text: canonicalText };
}

/**
 * Ignore-style canon: the canonical lines must all be present, in order, at the
 * top of the file. Anything the repo adds below them is its own business — an
 * extra ignore rule can only widen protection, never expose a canonical entry.
 * Applying never clobbers the repo-local tail; it re-seats canon above it.
 */
function planAppendable(repoDir, relFile, canonicalText) {
  const current = readIf(path.join(repoDir, relFile));
  const canon = norm(canonicalText);

  if (current !== null && norm(current).startsWith(canon)) {
    const extra = norm(current).slice(canon.length).trim();
    const note = extra ? `(+${extra.split("\n").filter((l) => l.trim()).length} repo-local line(s))` : undefined;
    return { file: relFile, found: "ok", note };
  }
  // Preserve anything the repo added that canon does not already cover.
  const canonLines = new Set(canon.split("\n").map((l) => l.trim()));
  const tail = (current === null ? [] : norm(current).split("\n")).filter(
    (line) => line.trim() && !line.trim().startsWith("#") && !canonLines.has(line.trim()),
  );
  const merged = tail.length ? `${canon.replace(/\n*$/u, "\n")}\n${tail.join("\n")}\n` : canon;
  return { file: relFile, found: current === null ? "missing" : "drift", text: merged };
}

/** Every file under a directory, as forward-slash paths relative to it. */
const walkFiles = (dir, base = dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full).replaceAll("\\", "/"));
  }
  return out;
};

/**
 * Recursive verbatim sync of a COPY_DIRS tree. Source is the TEMPLATE ROOT,
 * not skeleton/ — the template's own copy is the canonical, live one. A file
 * in the target that canon does not name is drift ("extra") and --apply
 * removes it: removals must propagate, or a renamed skill lives on in every
 * repo it ever reached.
 */
function planDir(repoDir, relDir) {
  const srcDir = path.join(TEMPLATE_ROOT, relDir);
  const canonFiles = walkFiles(srcDir);
  const steps = canonFiles.map((rel) => planFile(repoDir, `${relDir}/${rel}`, fs.readFileSync(path.join(srcDir, rel), "utf8")));
  const destDir = path.join(repoDir, relDir);
  if (!fs.existsSync(destDir)) return steps;
  const canonSet = new Set(canonFiles);
  for (const rel of walkFiles(destDir)) {
    if (!canonSet.has(rel)) steps.push({ file: `${relDir}/${rel}`, found: "extra", remove: true });
  }
  return steps;
}

function planPackageJson(repoDir, manifest) {
  const current = readIf(path.join(repoDir, "package.json"));
  // The sync merges into a package.json and never writes one from nothing.
  if (current === null) return { file: "package.json", found: "missing" };
  const pkg = JSON.parse(stripBom(current));
  const changes = [];
  pkg.scripts ??= {};
  for (const [name, cmd] of Object.entries(manifest.CANONICAL_SCRIPTS)) {
    if (pkg.scripts[name] !== cmd) {
      pkg.scripts[name] = cmd;
      changes.push(`scripts.${name}`);
    }
  }
  pkg.devDependencies ??= {};
  for (const [dep, version] of Object.entries(manifest.CANONICAL_DEV_DEPS)) {
    if (pkg.devDependencies[dep] !== version) {
      pkg.devDependencies[dep] = version;
      changes.push(`devDependencies.${dep}`);
    }
  }
  if (!pkg.engines?.node) {
    pkg.engines = { ...pkg.engines, node: ">=20" };
    changes.push("engines.node");
  }
  if (!changes.length) return { file: "package.json", found: "ok" };
  return { file: "package.json", label: `package.json (${changes.join(", ")})`, found: "drift", text: JSON.stringify(pkg, null, 2) + "\n" };
}

function planRepo(repoDir, manifest) {
  const steps = [];
  for (const relFile of manifest.COPY) steps.push(planFile(repoDir, relFile, skeletonText(relFile)));
  for (const relDir of manifest.COPY_DIRS) steps.push(...planDir(repoDir, relDir));
  for (const relFile of manifest.APPEND_OK) steps.push(planAppendable(repoDir, relFile, skeletonText(relFile)));
  for (const relFile of manifest.COPY_IF_PACK_DATA) {
    if (fs.existsSync(path.join(repoDir, "tools", "pack-data.mjs"))) steps.push(planFile(repoDir, relFile, skeletonText(relFile)));
    else steps.push({ file: relFile, found: "custom", label: `${relFile} (no tools/pack-data.mjs — module keeps its own builder)` });
  }
  const vars = renderVars(readJson(path.join(repoDir, "module.json")), repoDir);
  for (const relFile of manifest.RENDER) steps.push(planFile(repoDir, relFile, render(skeletonText(relFile), vars)));
  steps.push(planPackageJson(repoDir, manifest));
  return steps;
}

/**
 * The paths among `files` that hold bytes git cannot give back: modified,
 * staged, untracked or ignored. The status is asked for these paths alone, so
 * a record it returns is one of them; a rename's source comes as a record of
 * its own, and a repo that is a directory of a larger one reports every path
 * from that one's root. Every file is asked for by name: left to itself, the
 * status reports a directory that is ignored whole as one entry, which names
 * none of the files in it. Letter case is folded, as the file systems that
 * hold one file under two spellings fold it.
 */
function uncommitted(repoDir, files) {
  if (!files.length) return new Set();
  const prefix = gitIn(repoDir, "rev-parse", "--show-prefix").trim().toLowerCase();
  const records = gitIn(repoDir, "--literal-pathspecs", "status", "--porcelain", "-z", "--untracked-files=all", "--ignored", "--", ...files).split("\0");
  const reported = new Set();
  for (let i = 0; i < records.length; i++) {
    if (records[i].length < 4) continue;
    const paths = /[RC]/u.test(records[i].slice(0, 2)) ? [records[i].slice(3), records[++i] ?? ""] : [records[i].slice(3)];
    for (const p of paths.map((each) => each.toLowerCase())) reported.add(p.startsWith(prefix) ? p.slice(prefix.length) : p);
  }
  return new Set(files.filter((f) => reported.has(f.toLowerCase())));
}

/** Why a target cannot be read as a module repo, or null where it can. */
function unreadable(repoDir) {
  if (!fs.existsSync(repoDir)) return "directory not found";
  if (!fs.existsSync(path.join(repoDir, "module.json"))) return "no module.json (not a module repo)";
  try {
    if (gitIn(repoDir, "rev-parse", "--is-inside-work-tree").trim() === "true") return null;
  } catch {
    /* not a repository at all */
  }
  return "not a git work tree, so the sync cannot tell a committed file from an uncommitted one";
}

const line = (status, file) => console.log(`  ${status.padEnd(14)} ${file}`);

function act(repoDir, step) {
  const dest = path.join(repoDir, step.file);
  if (step.remove) {
    fs.rmSync(dest);
    return "removed";
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, step.text);
  return step.found === "missing" ? "created" : "updated";
}

function syncRepo(repoDir, manifest, tally) {
  console.log(`\n=== ${path.basename(repoDir)} ===`);
  let steps, dirty;
  const writes = (step) => step.text !== undefined || step.remove === true;
  try {
    const why = unreadable(repoDir);
    if (why) throw new Error(why);
    steps = planRepo(repoDir, manifest);
    dirty = uncommitted(repoDir, steps.filter(writes).map((step) => step.file));
  } catch (e) {
    console.log(`  not read: ${e.message.split("\n")[0]}`);
    tally.unread++;
    return;
  }
  tally.read++;
  const hold = APPLY && dirty.size > 0 && !FORCE;
  for (const step of steps) {
    const label = step.label ?? step.file;
    if (step.found === "ok" || step.found === "custom") line(step.found, label);
    else if (!APPLY) {
      line(step.found, dirty.has(step.file) ? `${label}  (uncommitted)` : label);
      tally.drift++;
    } else if (!writes(step)) {
      line(step.found, `${label}  (the sync does not create one)`);
      tally.left++;
    } else if (hold) line(dirty.has(step.file) ? "held" : step.found, label);
    else {
      line(act(repoDir, step), label);
      tally.written++;
    }
    if (step.note) console.log(`${" ".repeat(17)}${step.note}`);
  }
  if (hold) {
    console.log(`  held: ${dirty.size} path(s) the sync would write carry uncommitted changes, so nothing is written in this repo (--force writes them too)`);
    tally.held++;
  } else if (!APPLY && dirty.size) {
    console.log(`  note: --apply would hold this repo: ${dirty.size} of these path(s) carry uncommitted changes`);
  }
}

/** Where a run's targets are: the paths given, the repos named beside the template, or the manifest's own list. */
function targetsOf(manifest) {
  const beside = path.dirname(TEMPLATE_ROOT);
  const given = [...args.repoPaths.map((p) => path.resolve(p)), ...args.repos.map((name) => path.resolve(beside, name))];
  return given.length ? given : manifest.DEFAULT_TARGETS.map((name) => path.resolve(beside, name));
}

/** The paths of this repository that are canon, or decide what canon is. */
const canonPaths = (manifest) => ["skeleton", ...manifest.COPY_DIRS, "manifest.mjs", "bin/sync-toolchain.mjs"];

/**
 * The sync itself, with the tree this file sits in as canon. It runs where
 * `--worktree` asks for that tree, and from an export, where the tree is a
 * commit's and the run that made the export has already said which.
 */
async function engine(canon, announce) {
  const manifest = await import("../manifest.mjs");
  if (announce) console.log(`canon: ${canon}${announce.detail}`);
  const tally = { read: 0, unread: 0, drift: 0, written: 0, held: 0, left: 0 };
  for (const repoDir of targetsOf(manifest)) syncRepo(repoDir, manifest, tally);

  // A run that left a target unread says so in place of the line a level run
  // ends on: whoever reads only the last line must not read that one.
  if (tally.unread || !tally.read) {
    const found = APPLY ? `${tally.written} file(s) written` : `${tally.drift} drifted file(s)`;
    console.log(`\nnot done: ${tally.unread} target(s) not read, ${tally.read} read with ${found}; canon is ${canon}`);
    return EXIT.unable;
  }
  const repos = [`${tally.read} repo(s) read`];
  if (tally.held) repos.push(`${tally.held} held with nothing written`);
  if (tally.left) repos.push(`${tally.left} path(s) the sync does not write`);
  const count = APPLY ? `${tally.written} file(s) written` : `${tally.drift} file(s) drifted from canon`;
  console.log(`\ndone: ${count} in ${repos.join(", ")}; canon is ${canon}`);
  return (APPLY ? tally.held || tally.left : tally.drift) ? EXIT.drift : 0;
}

/** Whether this file sits at the top of a repository of its own, and not in a copy without history or inside another repository. */
function ownRepo() {
  try {
    return samePath(git("rev-parse", "--show-toplevel").trim(), TEMPLATE_ROOT);
  } catch {
    return false;
  }
}

const revOf = (rev) => {
  try {
    return git("rev-parse", "--verify", "--quiet", "--end-of-options", rev).trim() || null;
  } catch {
    return null;
  }
};

/** The working tree as a canon, named for the run's first line: the commit it stands on and how far it has moved from it. */
function worktreeCanon(manifest) {
  try {
    if (!ownRepo()) return { name: "this working tree", detail: " (a copy with no git history of its own)" };
    const moved = git("status", "--porcelain", "--untracked-files=all", "--", ...canonPaths(manifest)).split("\n").filter(Boolean).length;
    return { name: `this working tree at ${git("rev-parse", "--short=12", "HEAD").trim()}`, detail: moved ? `, with ${moved} uncommitted path(s) of canon` : "" };
  } catch {
    return { name: "this working tree", detail: "" };
  }
}

/** `origin/main` as this run fetches it. A fetch that fails stops `--apply`; `--check` goes on with the branch as last fetched. */
function pushedCanon() {
  let failure = null;
  try {
    execFileSync("git", ["-C", TEMPLATE_ROOT, "fetch", "--quiet", "--no-tags", REMOTE, `+refs/heads/${BRANCH}:${TIP}`], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: FETCH_MS,
      // A fetch that would stop to ask for a credential fails instead.
      env: { ...GIT_ENV, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    });
  } catch (e) {
    failure = String(e.stderr ?? "").trim().split("\n").pop() || e.message.split("\n")[0];
  }
  const sha = revOf(TIP);
  if (sha && !failure) return { sha, name: `${sha.slice(0, 12)} (${REMOTE}/${BRANCH}, fetched)` };
  if (APPLY) throw new Unable(`${REMOTE}/${BRANCH} could not be fetched (${failure}), and --apply writes only what is on it now`);
  if (!sha) throw new Unable(`this repository has no ${REMOTE}/${BRANCH} (${failure}); --from <rev> names a commit and --worktree reads the tree`);
  return { sha, name: `${sha.slice(0, 12)} (${REMOTE}/${BRANCH} as last fetched; the fetch failed: ${failure})` };
}

function namedCanon(rev) {
  const sha = revOf(`${rev}^{commit}`);
  if (!sha) throw new Unable(`--from: ${rev} names no commit in this repository`);
  return { sha, name: `${sha.slice(0, 12)} (${rev})` };
}

/**
 * A commit's whole tree, written into a scratch directory through an index of
 * its own, so neither the working tree nor the index a session stages in is
 * touched.
 */
function exportCommit(sha) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acks-sync-"));
  const tree = path.join(dir, "canon");
  const env = { ...GIT_ENV, GIT_INDEX_FILE: path.join(dir, "index") };
  const run = (...a) => execFileSync("git", ["-C", TEMPLATE_ROOT, ...a], { env, stdio: ["ignore", "pipe", "pipe"] });
  run("read-tree", sha);
  run("checkout-index", "--all", `--prefix=${tree.replaceAll("\\", "/")}/`);
  return { dir, tree };
}

/** The canon this tree holds that a run from a commit does not read: paths not committed, and paths committed after that commit. */
function leftOut(sha, manifest) {
  try {
    const paths = canonPaths(manifest);
    const rows = [
      ...git("status", "--porcelain", "--untracked-files=all", "--", ...paths).split("\n").filter(Boolean).map((l) => ["uncommitted", l.slice(3)]),
      ...[...new Set(git("log", "--format=", "--name-only", `${sha}..HEAD`, "--", ...paths).split("\n").filter(Boolean))].map((p) => ["committed", p]),
    ];
    if (!rows.length) return [];
    const shown = rows.slice(0, 12).map(([how, p]) => `  ${how.padEnd(14)} ${p}`);
    if (rows.length > shown.length) shown.push(`  (+${rows.length - shown.length} more)`);
    return [`note: this tree holds canon this run does not read, uncommitted or committed after it (--check --worktree reads the tree):`, ...shown];
  } catch {
    return [];
  }
}

/**
 * The run a session starts. It settles which canon is meant; a commit is
 * exported and the sync started from the export, and the working tree is
 * synced from where this file sits.
 */
async function front() {
  const mode = args.canon ?? (APPLY ? "pushed" : CHECK_CANON);
  if (mode === "worktree") {
    const canon = worktreeCanon(await import("../manifest.mjs"));
    return engine(canon.name, canon);
  }
  if (!ownRepo()) throw new Unable("canon is read from a commit, and this copy of the template has no git history of its own; --check --worktree reads its files");
  const canon = mode === "rev" ? namedCanon(args.from) : pushedCanon();
  const scratch = exportCommit(canon.sha);
  try {
    const script = path.join(scratch.tree, "bin", "sync-toolchain.mjs");
    if (!fs.existsSync(script)) throw new Unable(`${canon.name} holds no bin/sync-toolchain.mjs to run`);
    const manifest = await import(url.pathToFileURL(path.join(scratch.tree, "manifest.mjs")).href);
    const targets = targetsOf(manifest);
    // Written out before the engine starts, so the two processes' lines keep their order.
    const opening = [`canon: ${canon.name}`, ...leftOut(canon.sha, manifest)];
    await new Promise((resolve) => process.stdout.write(`${opening.join("\n")}\n`, resolve));
    // The engine is another commit's copy of this file, so the command line it
    // is started with here is one every copy has to read the same way.
    const child = spawn(process.execPath, [script, ...(APPLY ? ["--apply", ...(FORCE ? ["--force"] : [])] : ["--check"]), ...targets.flatMap((t) => ["--repo-path", t])], {
      stdio: "inherit",
      env: { ...process.env, [EXPORT_ENV]: JSON.stringify({ dir: scratch.tree, name: canon.name }) },
    });
    return await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? EXIT.unable));
    });
  } finally {
    fs.rmSync(scratch.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * The canon's name where this process is the engine a run started from an
 * export, and null where it is anything else. An export is the directory the
 * variable names and holds no repository; a working tree holds one, so the
 * variable cannot make a tree a canon to apply.
 */
function startedFromExport() {
  try {
    const { dir, name } = JSON.parse(process.env[EXPORT_ENV] ?? "null") ?? {};
    if (typeof dir !== "string" || !samePath(dir, TEMPLATE_ROOT) || fs.existsSync(path.join(TEMPLATE_ROOT, ".git"))) return null;
    return String(name);
  } catch {
    return null;
  }
}

try {
  const exported = startedFromExport();
  process.exitCode = exported === null ? await front() : await engine(exported, null);
} catch (e) {
  console.error(e instanceof Unable ? `sync-toolchain: ${e.message}` : e.stack ?? e);
  process.exitCode = EXIT.unable;
}
