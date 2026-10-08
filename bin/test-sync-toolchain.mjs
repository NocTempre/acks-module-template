/**
 * Drives bin/sync-toolchain.mjs in throwaway repositories and checks what the
 * sync exists to guarantee: canon is the commit a run names and no edit lying
 * beside it, `--apply` writes nothing but the pushed branch and destroys
 * nothing git cannot give back, and a run that could not read a target does
 * not end as a level one does.
 *
 * Usage:  node bin/test-sync-toolchain.mjs [--script <file>]
 *         (`--script` is the sync to test and defaults to
 *         bin/sync-toolchain.mjs; pass a modified copy to confirm a case
 *         fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const SCRIPT = path.resolve(option("--script", path.join(TEMPLATE_ROOT, "bin", "sync-toolchain.mjs")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A caller's own repository variables would turn the fixtures' git toward the
// caller's repository, and the variable a run sets for its engine is a case's
// to set.
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_PREFIX|ACKS_SYNC_EXPORT)$/iu.test(key)),
);

/** A manifest with one entry of each class, so a case reads at a glance. */
const MANIFEST = `export const COPY = ["LICENSE", "tools/validate.mjs"];
export const APPEND_OK = [".gitignore"];
export const COPY_DIRS = [".claude/skills", ".claude/rules"];
export const COPY_IF_PACK_DATA = ["tools/build-packs.mjs"];
export const RENDER = ["CLAUDE.md"];
export const CANONICAL_DEV_DEPS = { "left-pad": "^1.3.0" };
export const CANONICAL_SCRIPTS = { validate: "node tools/validate.mjs" };
export const DEFAULT_TARGETS = ["module-one"];
`;
const IGNORE = "node_modules/\npacks/*/\n";
const CANON = {
  ".gitattributes": "* text=auto eol=lf\n",
  "manifest.mjs": MANIFEST,
  "skeleton/LICENSE": "licence 1\n",
  "skeleton/tools/validate.mjs": "// validate 1\n",
  "skeleton/tools/build-packs.mjs": "// build 1\n",
  "skeleton/.gitignore": IGNORE,
  "skeleton/CLAUDE.md": "# {{MODULE_TITLE}} ({{MODULE_ID}})\nrepo {{REPO_DIR}}, lang {{LANG_PREFIX}}\n",
  ".claude/skills/alpha/SKILL.md": "alpha 1\n",
  ".claude/rules/one.md": "one 1\n",
};
const VALIDATE = "tools/validate.mjs";
const SKILL = ".claude/skills/alpha/SKILL.md";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-sync-test-"));
const results = [];

/** A directory as a repository, with the few things a case does in one. */
function repoAt(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: ENV });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const read = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), "utf8") : null);
  const identify = () => {
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  return { dir, git, write, read, identify, commit };
}

/**
 * A template with an origin it has pushed to, and a module repo beside it
 * under the manifest's default name. `files` is the template's canon, or a
 * function that puts one there. The sync that runs is the template's own copy
 * of the script under test, and its scratch directory is the fixture's, where
 * a case can see whether one was left behind.
 */
function fixture(name, { files = CANON, target = "module-one" } = {}) {
  const root = path.join(tmp, name);
  const scratch = path.join(root, "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  const origin = path.join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: ENV, stdio: "pipe" });

  const template = repoAt(path.join(root, "acks-module-template"));
  template.git("init", "-q", "-b", "main");
  template.identify();
  if (typeof files === "function") files(template.dir);
  else for (const [rel, text] of Object.entries(files)) template.write(rel, text);
  template.write("bin/sync-toolchain.mjs", fs.readFileSync(SCRIPT, "utf8"));
  template.git("remote", "add", "origin", origin);
  template.commit("canon 1");
  template.git("push", "-q", "origin", "main");

  const module = repoAt(path.join(root, target));
  module.git("init", "-q", "-b", "main");
  module.identify();
  module.write("module.json", `${JSON.stringify({ id: "module-one", title: "ACKS II — Module One", description: "A fixture.", url: "https://github.com/NocTempre/module-one-repo" }, null, 2)}\n`);
  module.write("package.json", `${JSON.stringify({ name: "module-one", private: true, scripts: { test: "node --test" } }, null, 2)}\n`);
  module.write("scripts/main.mjs", "export {};\n");
  module.commit("module");

  const sync = (args, { cwd = root, script = path.join(template.dir, "bin", "sync-toolchain.mjs"), env = {} } = {}) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { ...ENV, TEMP: scratch, TMP: scratch, TMPDIR: scratch, ...env } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /** The pushed canon applied and committed in the module: the level state a case starts from. */
  const level = () => {
    const r = sync(["--apply"]);
    module.commit("sync");
    return r;
  };
  /** A new commit of canon in the template, pushed unless a case says not. */
  const canon = (changed, { push = true } = {}) => {
    for (const [rel, text] of Object.entries(changed)) template.write(rel, text);
    const sha = template.commit("canon");
    if (push) template.git("push", "-q", "origin", "main");
    return sha;
  };
  return { root, scratch, origin, template, module, sync, level, canon };
}

async function test(name, body) {
  const problems = [];
  const check = (what, ok, detail = "") => {
    if (!ok) problems.push(`${what}${detail ? `\n      ${String(detail).trim().split("\n").join("\n      ")}` : ""}`);
  };
  try {
    await body(check);
  } catch (e) {
    problems.push(`threw: ${e.stack ?? e}${e.stderr ? `\n${e.stderr}` : ""}`);
  }
  results.push(problems.length === 0);
  console.log(problems.length ? `FAIL ${name}\n  ${problems.join("\n  ")}` : `ok   ${name}`);
}

try {
  await test("each manifest class syncs as declared, and a level run says what it read", (check) => {
    const f = fixture("classes");
    const first = f.level();
    check("--apply into a module that holds no canon exits 0", first.status === 0 && /created\s+LICENSE/u.test(first.out), first.out);
    check("COPY is written verbatim", f.module.read("LICENSE") === "licence 1\n" && f.module.read(VALIDATE) === "// validate 1\n");
    check("COPY_DIRS come from the template's root", f.module.read(SKILL) === "alpha 1\n" && f.module.read(".claude/rules/one.md") === "one 1\n");
    check("APPEND_OK is written", f.module.read(".gitignore") === IGNORE);
    check("RENDER is filled from module.json", f.module.read("CLAUDE.md") === "# Module One (module-one)\nrepo module-one-repo, lang MODULE-ONE\n", f.module.read("CLAUDE.md"));
    check("COPY_IF_PACK_DATA is left alone where the module has no pack data", f.module.read("tools/build-packs.mjs") === null && /custom\s+tools\/build-packs\.mjs/u.test(first.out), first.out);
    const pkg = JSON.parse(f.module.read("package.json"));
    check("package.json is merged, and what the module had is kept", pkg.scripts.validate === "node tools/validate.mjs" && pkg.scripts.test === "node --test" && pkg.devDependencies["left-pad"] === "^1.3.0" && pkg.engines.node === ">=20", f.module.read("package.json"));

    const again = f.sync(["--check", "--pushed"]);
    check("a level module reads level, and the last line names the repos read and the canon", again.status === 0 && /\ndone: 0 file\(s\) drifted from canon in 1 repo\(s\) read; canon is [0-9a-f]{12} \(origin\/main, fetched\)\n/u.test(again.out), again.out);

    fs.appendFileSync(path.join(f.module.dir, ".gitignore"), "local-only/\n");
    f.module.write("LICENSE", "licence 1\r\n");
    f.module.commit("the module's own lines");
    const own = f.sync(["--check", "--pushed"]);
    check("a line the module adds below the canonical ignores, and a copy that differs only in line endings, read level", own.status === 0 && /\(\+1 repo-local line\(s\)\)/u.test(own.out), own.out);
    f.module.write("tools/pack-data.mjs", "export default [];\n");
    f.module.commit("pack data");
    f.canon({ "skeleton/.gitignore": `${IGNORE}*.log\n` });
    const r = f.sync(["--apply"]);
    check("a changed ignore file is re-seated above the module's own line", r.status === 0 && f.module.read(".gitignore") === `${IGNORE}*.log\n\nlocal-only/\n`, `${r.out}\n${f.module.read(".gitignore")}`);
    check("and the builder syncs once the module has pack data", f.module.read("tools/build-packs.mjs") === "// build 1\n");
  });

  await test("where no flag names a canon, --check reads origin/main as it fetches it", (check) => {
    const f = fixture("default");
    f.level();
    f.template.write("skeleton/tools/validate.mjs", "// validate, not committed\n");
    const r = f.sync(["--check"]);
    check("an uncommitted edit of canon is not drift", r.status === 0 && /\ndone: 0 file\(s\) drifted from canon in 1 repo\(s\) read; canon is [0-9a-f]{12} \(origin\/main, fetched\)\n/u.test(r.out), r.out);
    check("and the run lists the edit as canon it did not read", /uncommitted\s+skeleton\/tools\/validate\.mjs/u.test(r.out), r.out);
    check("--check --pushed is the same run", f.sync(["--check", "--pushed"]).out === r.out);
    const tree = f.sync(["--check", "--worktree"]);
    check("--check --worktree reads the tree, where the edit is drift", tree.status === 1 && /drift\s+tools\/validate\.mjs/u.test(tree.out), tree.out);
    check("and its first line says the tree was read, and that it has moved", /^canon: this working tree at [0-9a-f]{12}, with 1 uncommitted path\(s\) of canon\n/u.test(tree.out), tree.out);
  });

  await test("--apply writes origin/main, and an edit in the template's tree takes no part", (check) => {
    const f = fixture("pushed");
    check("the module is brought level", f.level().status === 0 && f.sync(["--check", "--pushed"]).status === 0);
    const pushed = f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n" });
    f.template.write("skeleton/tools/validate.mjs", "// validate, not committed\n");
    f.template.write(".claude/skills/alpha/draft.md", "not committed\n");
    f.template.git("add", ".claude/skills/alpha/draft.md");
    const r = f.sync(["--apply"]);
    check("--apply exits 0", r.status === 0, r.out);
    check("the module holds the text that was pushed", f.module.read(VALIDATE) === "// validate 2\n", f.module.read(VALIDATE));
    check("a file the template's tree holds and no commit does is not synced, staged or not", f.module.read(".claude/skills/alpha/draft.md") === null);
    check("the run names the commit it read", r.out.startsWith(`canon: ${pushed.slice(0, 12)} (origin/main, fetched)\n`), r.out);
    check("and each path of canon it left out", /uncommitted\s+skeleton\/tools\/validate\.mjs/u.test(r.out) && /uncommitted\s+\.claude\/skills\/alpha\/draft\.md/u.test(r.out), r.out);
    check("the template's tree is as the session left it", f.template.read("skeleton/tools/validate.mjs") === "// validate, not committed\n" && f.template.read(".claude/skills/alpha/draft.md") === "not committed\n");
    check("the index a session stages in holds what the session staged, and nothing else", f.template.git("diff", "--cached", "--name-only").trim() === ".claude/skills/alpha/draft.md", f.template.git("status", "--porcelain"));
    check("the scratch directory is gone", fs.readdirSync(f.scratch).length === 0, fs.readdirSync(f.scratch).join(" "));
    const tree = f.sync(["--check", "--worktree"]);
    check("--check --worktree reads the tree, both edits included", tree.status === 1 && /drift\s+tools\/validate\.mjs/u.test(tree.out) && /missing\s+\.claude\/skills\/alpha\/draft\.md/u.test(tree.out), tree.out);
  });

  await test("a commit that is not on origin/main is not applied", (check) => {
    const f = fixture("unpushed");
    f.level();
    f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n" }, { push: false });
    const r = f.sync(["--apply"]);
    check("--apply writes nothing: the module is level with what is pushed", r.status === 0 && f.module.read(VALIDATE) === "// validate 1\n" && /done: 0 file\(s\) written/u.test(r.out), r.out);
    check("and names the committed path it left out", /committed\s+skeleton\/tools\/validate\.mjs/u.test(r.out), r.out);
    const from = f.sync(["--apply", "--from", "HEAD"]);
    check("--apply --from is refused", from.status === 2 && f.module.read(VALIDATE) === "// validate 1\n", from.out);
    const tree = f.sync(["--apply", "--worktree"]);
    check("--apply --worktree is refused", tree.status === 2 && f.module.read(VALIDATE) === "// validate 1\n", tree.out);
    const preview = f.sync(["--check", "--from", "HEAD"]);
    check("--check --from HEAD shows what the commit would change", preview.status === 1 && /drift\s+tools\/validate\.mjs/u.test(preview.out) && /^canon: [0-9a-f]{12} \(HEAD\)\n/u.test(preview.out), preview.out);
    check("--check --pushed does not", f.sync(["--check", "--pushed"]).status === 0);
    f.template.git("push", "-q", "origin", "main");
    const after = f.sync(["--apply"]);
    check("pushed, the same commit is applied", after.status === 0 && f.module.read(VALIDATE) === "// validate 2\n", after.out);
  });

  await test("--apply fetches: a commit pushed from another clone is the canon", (check) => {
    const f = fixture("fetch");
    f.level();
    const other = repoAt(path.join(f.root, "other"));
    execFileSync("git", ["clone", "-q", f.origin, other.dir], { env: ENV, stdio: "pipe" });
    other.identify();
    other.write("skeleton/tools/validate.mjs", "// validate from elsewhere\n");
    const elsewhere = other.commit("canon from elsewhere");
    other.git("push", "-q", "origin", "main");
    check("the template has not heard of it", f.template.git("rev-parse", "origin/main").trim() !== elsewhere);
    const r = f.sync(["--apply"]);
    check("the module holds what the other clone pushed", r.status === 0 && f.module.read(VALIDATE) === "// validate from elsewhere\n", r.out);
    check("the template's own files are not moved to it", f.template.read("skeleton/tools/validate.mjs") === "// validate 1\n" && f.template.git("status", "--porcelain").trim() === "");

    // git moves origin/main on its own account only where the clone's fetch
    // configuration names the branch, and a clone made for another branch
    // names that one alone.
    f.module.commit("sync");
    f.template.git("config", "remote.origin.fetch", "+refs/heads/other:refs/remotes/origin/other");
    other.write("skeleton/tools/validate.mjs", "// validate from elsewhere, again\n");
    const again = other.commit("canon from elsewhere, again");
    other.git("push", "-q", "origin", "main");
    const narrow = f.sync(["--apply"]);
    check("a clone configured to fetch some other branch still reads this one's tip", narrow.status === 0 && f.module.read(VALIDATE) === "// validate from elsewhere, again\n" && narrow.out.startsWith(`canon: ${again.slice(0, 12)} (origin/main, fetched)\n`), narrow.out);
  });

  await test("where origin cannot be reached, --apply stops and --check reads the branch as last fetched", (check) => {
    const f = fixture("offline");
    f.level();
    f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n" });
    f.template.git("remote", "set-url", "origin", path.join(f.root, "gone.git"));
    const a = f.sync(["--apply"]);
    check("--apply exits 2 and writes nothing", a.status === 2 && f.module.read(VALIDATE) === "// validate 1\n" && /could not be fetched/u.test(a.out), a.out);
    const c = f.sync(["--check", "--pushed"]);
    check("--check --pushed compares against the branch as last fetched, and says so", c.status === 1 && /origin\/main as last fetched; the fetch failed/u.test(c.out) && /drift\s+tools\/validate\.mjs/u.test(c.out), c.out);
    f.template.git("remote", "remove", "origin");
    const none = f.sync(["--check", "--pushed"]);
    check("with no origin/main at all it exits 2", none.status === 2 && !/done:/u.test(none.out), none.out);
    check("and a commit can still be named", f.sync(["--check", "--from", "HEAD"]).status === 1);
  });

  await test("a shallow checkout inside the module, as CI makes one, checks the module against the branch", (check) => {
    const f = fixture("ci");
    f.level();
    const checkout = path.join(f.module.dir, ".toolchain-template");
    execFileSync("git", ["clone", "-q", "--depth", "1", url.pathToFileURL(f.origin).href, checkout], { env: ENV, stdio: "pipe" });
    const script = path.join(checkout, "bin", "sync-toolchain.mjs");
    const ci = (...canon) => f.sync(["--check", ...canon, "--repo-path", f.module.dir], { cwd: f.module.dir, script });
    for (const canon of [[], ["--pushed"], ["--worktree"]]) {
      const r = ci(...canon);
      check(`a level module passes (${canon[0] ?? "no canon flag"})`, r.status === 0 && /done: 0 file\(s\) drifted from canon in 1 repo\(s\) read/u.test(r.out), r.out);
    }
    // The command line every module's workflow runs, read out of the workflow.
    const workflow = fs.readFileSync(path.join(TEMPLATE_ROOT, "skeleton", ".github", "workflows", "toolchain-check.yml"), "utf8");
    const flags = workflow.match(/^\s*run: node \.toolchain-template\/bin\/sync-toolchain\.mjs (.+) --repo-path "\$GITHUB_WORKSPACE"$/mu)?.[1].split(" ");
    const asWorkflow = flags ? f.sync([...flags, "--repo-path", f.module.dir], { cwd: f.module.dir, script }) : { status: null, out: workflow };
    check("the workflow's own command line is one the script reads, and it names the checkout as the canon", asWorkflow.status === 0 && /^canon: this working tree at [0-9a-f]{12}\n/u.test(asWorkflow.out), asWorkflow.out);
    f.module.write(VALIDATE, "// edited in the module\n");
    for (const canon of [[], ["--pushed"], ["--worktree"]]) {
      const r = ci(...canon);
      check(`a hand-edited copy fails (${canon[0] ?? "no canon flag"})`, r.status === 1 && /drift\s+tools\/validate\.mjs/u.test(r.out), r.out);
    }
    f.module.write(VALIDATE, "// validate 1\n");
    const later = f.canon({ "skeleton/LICENSE": "licence 2\n" });
    const r = ci("--pushed");
    check("--pushed fetches in the shallow checkout: a commit pushed after it was made is the canon", r.status === 1 && /drift\s+LICENSE/u.test(r.out) && r.out.startsWith(`canon: ${later.slice(0, 12)} `), r.out);
    check("and the check with no canon flag is the same run", ci().out === r.out);
    check("--worktree reads the checkout as it was made", ci("--worktree").status === 0);
    check("no scratch directory is left", fs.readdirSync(f.scratch).length === 0);
  });

  await test("--apply beside uncommitted work it does not write: canon is written and the rest is left", (check) => {
    const f = fixture("beside");
    f.level();
    f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n" });
    f.module.write("scripts/main.mjs", "export const peer = 1;\n");
    f.module.write("notes/draft.md", "a peer's notes\n");
    f.module.write("scripts/staged.mjs", "export {};\n");
    f.module.git("add", "scripts/staged.mjs");
    const r = f.sync(["--apply"]);
    check("--apply exits 0 and writes the one file", r.status === 0 && f.module.read(VALIDATE) === "// validate 2\n" && /done: 1 file\(s\) written in 1 repo\(s\) read/u.test(r.out), r.out);
    check("a modified file, an untracked one and a staged one are as they were", f.module.read("scripts/main.mjs") === "export const peer = 1;\n" && f.module.read("notes/draft.md") === "a peer's notes\n" && f.module.git("diff", "--cached", "--name-only").trim() === "scripts/staged.mjs");
  });

  await test("a repo is held, whole, where a path to be written carries an uncommitted change", (check) => {
    const f = fixture("held");
    f.level();
    f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n", [SKILL]: "alpha 2\n" });
    f.module.write(VALIDATE, "// edited in the module\n");
    // A file whose bytes are as committed and whose timestamp is not is one a
    // status would rewrite the index to take note of.
    const index = path.join(f.module.dir, ".git", "index");
    fs.utimesSync(path.join(f.module.dir, SKILL), new Date(2001, 0, 1), new Date(2001, 0, 1));
    const staged = fs.readFileSync(index);
    const seen = f.sync(["--check", "--pushed"]);
    check("--check marks the path and says --apply would hold", seen.status === 1 && /drift\s+tools\/validate\.mjs {2}\(uncommitted\)/u.test(seen.out) && /--apply would hold this repo: 1 of these/u.test(seen.out), seen.out);
    const r = f.sync(["--apply"]);
    check("--apply exits 1", r.status === 1, r.out);
    check("neither run rewrites the module's index, which a peer may be staging in", fs.readFileSync(index).equals(staged));
    check("the uncommitted file is as it was", f.module.read(VALIDATE) === "// edited in the module\n");
    check("and the clean file beside it is not written either", f.module.read(SKILL) === "alpha 1\n");
    check("the held path is named, and the last line says nothing was written", /held\s+tools\/validate\.mjs/u.test(r.out) && /done: 0 file\(s\) written in 1 repo\(s\) read, 1 held with nothing written/u.test(r.out), r.out);
    const forced = f.sync(["--apply", "--force"]);
    check("--force writes both", forced.status === 0 && f.module.read(VALIDATE) === "// validate 2\n" && f.module.read(SKILL) === "alpha 2\n", forced.out);
  });

  await test("a file git cannot give back holds the repo wherever canon would write or remove one", (check) => {
    const f = fixture("untracked");
    f.level();
    f.canon({ ".claude/rules/two.md": "two 1\n" });
    f.module.write(".claude/rules/two.md", "a peer's draft\n");
    let r = f.sync(["--apply"]);
    check("an untracked file where canon creates one: held, and still there", r.status === 1 && f.module.read(".claude/rules/two.md") === "a peer's draft\n", r.out);
    fs.rmSync(path.join(f.module.dir, ".claude/rules/two.md"));

    f.module.write(".claude/skills/alpha/local.md", "local\n");
    r = f.sync(["--apply"]);
    check("an untracked file canon does not name, which --apply would remove: held, and still there", r.status === 1 && f.module.read(".claude/skills/alpha/local.md") === "local\n" && f.module.read(".claude/rules/two.md") === null, r.out);
    f.module.commit("a file canon does not name");
    r = f.sync(["--apply"]);
    check("committed, the same file is removed and the run goes through", r.status === 0 && f.module.read(".claude/skills/alpha/local.md") === null && f.module.read(".claude/rules/two.md") === "two 1\n" && /removed\s+\.claude\/skills\/alpha\/local\.md/u.test(r.out), r.out);
    f.module.commit("sync");

    // A directory ignored whole is one entry to a status that is not asked for
    // each file in it by name.
    f.canon({ ".claude/rules/deep/three.md": "three 1\n" });
    fs.appendFileSync(path.join(f.module.dir, ".gitignore"), ".claude/rules/deep/\n");
    f.module.commit("ignore a directory");
    f.module.write(".claude/rules/deep/three.md", "ignored bytes\n");
    r = f.sync(["--apply"]);
    check("an ignored file where canon creates one, in a directory ignored whole: held, and still there", r.status === 1 && f.module.read(".claude/rules/deep/three.md") === "ignored bytes\n", r.out);
  });

  await test("a module that is a directory of a larger repository is held by what that repository has not committed", (check) => {
    const f = fixture("nested");
    const outer = repoAt(path.join(f.root, "outer"));
    outer.git("init", "-q", "-b", "main");
    outer.identify();
    const nested = path.join(outer.dir, "vendor", "module-one");
    fs.cpSync(f.module.dir, nested, { recursive: true, filter: (src) => path.basename(src) !== ".git" });
    const run = (...args) => f.sync([...args, "--repo-path", nested]);
    const read = (rel) => (fs.existsSync(path.join(nested, rel)) ? fs.readFileSync(path.join(nested, rel), "utf8") : null);
    const before = read("package.json");
    let r = run("--apply");
    check("its package.json is in no commit there: the module is held and nothing is written", r.status === 1 && /held\s+package\.json/u.test(r.out) && read("package.json") === before && read("LICENSE") === null, r.out);
    outer.commit("a module, vendored");
    r = run("--apply");
    check("committed there, the module is synced", r.status === 0 && read("LICENSE") === "licence 1\n" && JSON.parse(read("package.json")).scripts.validate === "node tools/validate.mjs", r.out);
    check("and reads level", run("--check", "--pushed").status === 0);
  });

  await test("a target that is not read fails the run, and the run does not end as a level one does", (check) => {
    const f = fixture("unread");
    f.level();
    const level = /done: 0 file\(s\) drifted from canon/u;
    const none = f.sync(["--check", "--pushed", "--repo", "no-such-repo"]);
    check("a directory that is not there", none.status === 2 && /not read: directory not found/u.test(none.out) && !level.test(none.out), none.out);
    fs.mkdirSync(path.join(f.root, "not-a-module"));
    const plain = f.sync(["--check", "--pushed", "--repo", "not-a-module"]);
    check("a directory with no module.json", plain.status === 2 && /not read: no module\.json/u.test(plain.out) && !level.test(plain.out), plain.out);
    fs.writeFileSync(path.join(f.root, "not-a-module", "module.json"), "{}\n");
    const bare = f.sync(["--check", "--pushed", "--repo", "not-a-module"]);
    check("a module that is not a git work tree", bare.status === 2 && /not read: not a git work tree/u.test(bare.out), bare.out);
    const both = f.sync(["--check", "--pushed", "--repo", "module-one", "--repo", "no-such-repo"]);
    check("one target of two: the one read is reported and the run is still exit 2", both.status === 2 && /=== module-one ===\n {2}ok/u.test(both.out) && /not done: 1 target\(s\) not read, 1 read/u.test(both.out) && !level.test(both.out), both.out);
    fs.renameSync(f.module.dir, path.join(f.root, "moved-away"));
    for (const args of [["--check", "--pushed"], ["--check", "--worktree"], ["--check"], ["--apply"]]) {
      const r = f.sync(args);
      check(`the default target missing (${args.join(" ")})`, r.status === 2 && !level.test(r.out), r.out);
    }
  });

  await test("an argument the script does not know is refused before anything is read or written", (check) => {
    const f = fixture("arguments");
    f.level();
    f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n" });
    for (const args of [
      ["--aply"],
      ["--apply", "--repo-pth", f.module.dir],
      ["--apply", "--repo"],
      ["--force"],
      ["--check", "--apply"],
      ["--check", "--from", "HEAD", "--worktree"],
      ["--check", "--pushed", "--worktree"],
      ["--check", "--from"],
      ["--check", "--from", "no-such-rev"],
      ["--apply", "--from", "HEAD"],
    ]) {
      const r = f.sync(args);
      check(`${args.join(" ")}`, r.status === 2 && !/===/u.test(r.out) && f.module.read(VALIDATE) === "// validate 1\n", `${r.status}\n${r.out}`);
    }
  });

  await test("a copy of the template with no history of its own reads its files under --worktree and nothing else", (check) => {
    const f = fixture("copy");
    f.level();
    const beside = path.join(f.root, "copies", "acks-module-template");
    fs.cpSync(f.template.dir, beside, { recursive: true, filter: (src) => path.basename(src) !== ".git" });
    // The second copy sits inside a repository that has an origin/main of its
    // own, which is the one a copy must not take for its history.
    const inside = path.join(f.template.dir, "vendored", "acks-module-template");
    fs.cpSync(beside, inside, { recursive: true });
    for (const [where, copy] of [["beside the module", beside], ["inside another repository", inside]]) {
      const script = path.join(copy, "bin", "sync-toolchain.mjs");
      const run = (...args) => f.sync([...args, "--repo-path", f.module.dir], { script });
      const tree = run("--check", "--worktree");
      check(`${where}: --worktree reads the copy's files, and says it has no history`, tree.status === 0 && /^canon: this working tree \(a copy with no git history of its own\)\n/u.test(tree.out) && /done: 0 file\(s\) drifted from canon in 1 repo\(s\) read/u.test(tree.out), tree.out);
      check(`${where}: --pushed is exit 2`, run("--check", "--pushed").status === 2, run("--check", "--pushed").out);
      const bare = run("--check");
      check(`${where}: so is the check with no canon flag, and it names --worktree`, bare.status === 2 && /--check --worktree reads its files/u.test(bare.out) && !/===/u.test(bare.out), bare.out);
      check(`${where}: --apply is exit 2`, run("--apply").status === 2, run("--apply").out);
    }
  });

  await test("the variable a run sets for its engine does not make a working tree a canon to apply", (check) => {
    const f = fixture("forged");
    f.level();
    f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n" });
    f.template.write("skeleton/tools/validate.mjs", "// validate, not committed\n");
    for (const [what, dir] of [["another directory", path.join(f.root, "elsewhere")], ["the working tree itself", f.template.dir]]) {
      f.module.write(VALIDATE, "// validate 1\n");
      const r = f.sync(["--apply"], { env: { ACKS_SYNC_EXPORT: JSON.stringify({ dir, name: "forged" }) } });
      check(`naming ${what}: what is written is what was pushed`, r.status === 0 && f.module.read(VALIDATE) === "// validate 2\n" && !/forged/u.test(r.out), r.out);
    }
  });

  await test("a caller's own repository variables do not turn the sync toward the caller's repository", (check) => {
    const f = fixture("hook");
    f.level();
    const pushed = f.canon({ "skeleton/tools/validate.mjs": "// validate 2\n" });
    // What git starts a hook with: the repository it runs for, and that
    // repository's index.
    const caller = repoAt(path.join(f.root, "caller"));
    caller.git("init", "-q", "-b", "main");
    caller.identify();
    caller.write("unrelated.txt", "the caller's\n");
    caller.commit("the caller's");
    const env = { GIT_DIR: path.join(caller.dir, ".git"), GIT_WORK_TREE: caller.dir, GIT_INDEX_FILE: path.join(caller.dir, ".git", "index") };
    const seen = f.sync(["--check", "--pushed"], { env });
    check("--check reads the template's branch and the module's own files", seen.status === 1 && seen.out.startsWith(`canon: ${pushed.slice(0, 12)} (origin/main, fetched)\n`) && /drift\s+tools\/validate\.mjs\n/u.test(seen.out), seen.out);
    const r = f.sync(["--apply"], { env });
    check("--apply writes the template's pushed canon into the module", r.status === 0 && f.module.read(VALIDATE) === "// validate 2\n", r.out);
    check("and the caller's repository is as it was", caller.git("status", "--porcelain").trim() === "" && caller.read("LICENSE") === null);
  });

  await test("this repository's own manifest and skeleton sync into a bare module and read level", async (check) => {
    const real = await import(url.pathToFileURL(path.join(TEMPLATE_ROOT, "manifest.mjs")).href);
    const f = fixture("real", {
      target: real.DEFAULT_TARGETS[0],
      files: (dir) => {
        fs.copyFileSync(path.join(TEMPLATE_ROOT, "manifest.mjs"), path.join(dir, "manifest.mjs"));
        fs.copyFileSync(path.join(TEMPLATE_ROOT, ".gitattributes"), path.join(dir, ".gitattributes"));
        for (const rel of ["skeleton", ...real.COPY_DIRS]) fs.cpSync(path.join(TEMPLATE_ROOT, rel), path.join(dir, rel), { recursive: true });
      },
    });
    const first = f.level();
    const named = [...real.COPY, ...real.APPEND_OK, ...real.RENDER];
    check("--apply exits 0 and creates every file the manifest names", first.status === 0 && named.every((rel) => f.module.read(rel) !== null), first.out);
    const again = f.sync(["--check", "--worktree"]);
    const pushed = f.sync(["--check", "--pushed"]);
    check("the module then reads level from the tree and from the branch", again.status === 0 && pushed.status === 0 && /done: 0 file\(s\) drifted from canon in 1 repo\(s\) read/u.test(pushed.out), `${again.out}\n${pushed.out}`);
    check("and every line is a file read level", pushed.out.split("\n").filter((l) => /^ {2}ok /u.test(l)).length >= named.length + real.COPY_DIRS.length, pushed.out);
  });
} finally {
  // A sync that was still writing may hold its scratch directory for a moment.
  for (let n = 0; n < 20; n++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      break;
    } catch {
      await sleep(250);
    }
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(`\ntest-sync-toolchain: ${results.length} cases against ${path.relative(TEMPLATE_ROOT, SCRIPT) || SCRIPT}, ${failed} failed`);
process.exit(failed ? 1 : 0);
