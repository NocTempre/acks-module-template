/**
 * Drives bin/new-module.mjs in throwaway templates and checks what the
 * scaffolder exists to guarantee: the module it builds holds every tree the
 * template hands a module, its first commit holds as executable each file the
 * manifest lists so, its last line says whether that module is level with
 * canon, and a module that differs, or one nobody compared, does not end as a
 * level one does.
 *
 * Usage:  node bin/test-new-module.mjs [--script <file>]
 *         (`--script` is the scaffolder to test and defaults to
 *         bin/new-module.mjs; pass a modified copy to confirm a case fails
 *         when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const SCRIPT = path.resolve(option("--script", path.join(TEMPLATE_ROOT, "bin", "new-module.mjs")));
const SYNC = path.join(TEMPLATE_ROOT, "bin", "sync-toolchain.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A caller's own repository variables would turn the fixtures' git toward the
// caller's repository. The scaffolder makes the module's first commit itself,
// so who commits, and that nothing is signed, is said here for every git it
// starts: a runner has no identity of its own.
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_PREFIX|ACKS_SYNC_EXPORT)$/iu.test(key))),
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

const PREPARE = "git config core.hooksPath .githooks";
const HOOK = ".githooks/pre-commit";
/** A manifest with one entry of each class the scaffolder's check reads, and one script a skeleton can lack. */
const MANIFEST = `export const COPY = ["LICENSE", "${HOOK}"];
export const APPEND_OK = [".gitignore"];
export const COPY_DIRS = [".claude/skills", ".claude/hooks"];
export const COPY_IF_PACK_DATA = [];
export const RENDER = ["CLAUDE.md"];
export const EXECUTABLE = ["${HOOK}"];
export const CANONICAL_DEV_DEPS = { "left-pad": "^1.3.0" };
export const CANONICAL_SCRIPTS = { validate: "node tools/validate.mjs", prepare: "${PREPARE}" };
export const DEFAULT_TARGETS = [];
`;
const packageJson = (scripts) =>
  `${JSON.stringify({ name: "{{MODULE_ID}}", private: true, engines: { node: ">=20" }, scripts, devDependencies: { "left-pad": "^1.3.0" } }, null, 2)}\n`;
const SETTINGS = { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/guard.mjs"' }] }] } };
const CANON = {
  ".gitattributes": "* text=auto eol=lf\n",
  "manifest.mjs": MANIFEST,
  "skeleton/LICENSE": "licence 1\n",
  [`skeleton/${HOOK}`]: "#!/bin/sh\nexit 0\n",
  "skeleton/.gitignore": "node_modules/\n",
  "skeleton/CLAUDE.md": "# {{MODULE_TITLE}} ({{MODULE_ID}})\nrepo {{REPO_DIR}}, lang {{LANG_PREFIX}}\n",
  "skeleton/README.md": "# ACKS II — {{MODULE_TITLE}}\n\n{{MODULE_DESCRIPTION}}\n",
  "skeleton/module.json": `${JSON.stringify({ id: "{{MODULE_ID}}", title: "ACKS II — {{MODULE_TITLE}}", description: "{{MODULE_DESCRIPTION}}" }, null, 2)}\n`,
  "skeleton/package.json": packageJson({ validate: "node tools/validate.mjs", prepare: PREPARE }),
  "skeleton/.claude/settings.json": `${JSON.stringify(SETTINGS, null, 2)}\n`,
  ".claude/skills/alpha/SKILL.md": "alpha 1\n",
  ".claude/hooks/guard.mjs": "// guard 1\n",
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-scaffold-test-"));
const results = [];

/** A directory as a repository, with the few things a case does in one. */
function repoAt(dir) {
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: ENV });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const read = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), "utf8") : null);
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  return { dir, git, write, read, commit };
}

/** The mode a module's last commit holds for a path. */
const modeOf = (module, rel) => module.git("ls-tree", "HEAD", "--", rel).split(/\s+/u)[0];

/** The hook files a module's settings start, as paths from the module's root. */
const hooksCalled = (module) => [...new Set([...module.read(".claude/settings.json").matchAll(/\.claude\/hooks\/[\w.-]+/gu)].map((hit) => hit[0]))];

/**
 * A template in a directory of its own, where the modules it scaffolds and
 * their rules stubs land beside it. `files` is the template's canon, or a
 * function that puts one there. With `history` the template is a repository
 * with an origin it has pushed to; without, it is the files alone. The
 * scaffolder that runs is the template's copy of the script under test, the
 * sync it starts is this repository's, and the scratch directory is the
 * fixture's, where a case can see whether one was left behind.
 */
function fixture(name, { files = CANON, history = true } = {}) {
  const root = path.join(tmp, name);
  const scratch = path.join(root, "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  const template = repoAt(path.join(root, "acks-module-template"));
  fs.mkdirSync(template.dir);
  if (typeof files === "function") files(template.dir);
  else for (const [rel, text] of Object.entries(files)) template.write(rel, text);
  template.write("bin/new-module.mjs", fs.readFileSync(SCRIPT, "utf8"));
  template.write("bin/sync-toolchain.mjs", fs.readFileSync(SYNC, "utf8"));
  if (history) {
    const origin = path.join(root, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: ENV, stdio: "pipe" });
    template.git("init", "-q", "-b", "main");
    template.git("remote", "add", "origin", origin);
    template.commit("canon 1");
    template.git("push", "-q", "origin", "main");
  }
  const run = (script, args, env = {}) => {
    const r = spawnSync(process.execPath, [path.join(template.dir, "bin", script), ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...ENV, TEMP: scratch, TMP: scratch, TMPDIR: scratch, ...env },
    });
    // The verdict is what the scaffolder prints last. Its refusals go to stderr, and `out` holds both.
    return { status: r.status, out: `${r.stdout}${r.stderr}`, last: r.stdout.trimEnd().split("\n").pop() };
  };
  return {
    root,
    scratch,
    template,
    scaffold: (args, env) => run("new-module.mjs", args, env),
    sync: (args) => run("sync-toolchain.mjs", args),
    module: (id) => repoAt(path.join(root, id)),
  };
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
  await test("a module built from a level tree holds what the template hands a module, and the last line says it is level", (check) => {
    const f = fixture("level");
    const r = f.scaffold(["acks-one", "--title", "One", "--desc", "A fixture."]);
    const m = f.module("acks-one");
    check("the run exits 0 and its last line is the verdict", r.status === 0 && /^level: /u.test(r.last), r.out);
    check("the canon the module was compared with is named, and is the pushed branch", /\ncanon: [0-9a-f]{12} \(origin\/main, fetched\)\n/u.test(r.out), r.out);
    check("the skeleton is rendered", m.read("README.md") === "# ACKS II — One\n\nA fixture.\n" && JSON.parse(m.read("module.json")).id === "acks-one", m.read("README.md"));
    check("the shared trees come from the template's root, as they are", m.read(".claude/skills/alpha/SKILL.md") === "alpha 1\n" && m.read(".claude/hooks/guard.mjs") === "// guard 1\n");
    const called = hooksCalled(m);
    check("every hook the module's settings start is a file in the module", called.length === 1 && called.every((rel) => m.read(rel) !== null), called.join(", "));
    check("the module is a repository with its first commit and nothing uncommitted", m.git("rev-list", "--count", "HEAD").trim() === "1" && m.git("status", "--porcelain").trim() === "", m.git("status", "--porcelain"));
    check("that commit holds the hook as executable, and the file beside it as a plain one", modeOf(m, HOOK) === "100755" && modeOf(m, "LICENSE") === "100644", m.git("ls-tree", "-r", "HEAD"));
    check("the rules stub is seeded beside the module", fs.existsSync(path.join(f.root, "acks-rules", "acks-one", "RULES.md")));
    check("the check's scratch directory is gone", fs.readdirSync(f.scratch).length === 0, fs.readdirSync(f.scratch).join(", "));
  });

  await test("a skeleton the manifest has moved past builds a module that is not level, and the run names the file", (check) => {
    const f = fixture("behind", { files: { ...CANON, "skeleton/package.json": packageJson({ validate: "node tools/validate.mjs" }) } });
    const r = f.scaffold(["acks-one", "--title", "One"]);
    check("the run exits 1", r.status === 1, r.out);
    check("the file is named with what it lacks", /drift\s+package\.json \(scripts\.prepare\)/u.test(r.out), r.out);
    check("the last line says the module was made and is not level", /^not level: .*acks-one was made/u.test(r.last), r.last);
    check("and the module is there", f.module("acks-one").read("module.json") !== null);
  });

  await test("a skeleton that lacks a file the manifest lists as executable builds a module that is not level, and the run names the file", (check) => {
    const rest = Object.fromEntries(Object.entries(CANON).filter(([rel]) => rel !== `skeleton/${HOOK}`));
    const f = fixture("no-hook", { files: { ...rest, "manifest.mjs": MANIFEST.replace(`, "${HOOK}"]`, "]") } });
    const r = f.scaffold(["acks-one", "--title", "One"]);
    check("the run exits 1 and the module is made", r.status === 1 && f.module("acks-one").read("module.json") !== null, r.out);
    check("the file is named as one the index does not hold", /mode\s+\.githooks\/pre-commit {2}\(not in the index; canon is 100755\)/u.test(r.out) && /^not level: /u.test(r.last), r.out);
  });

  await test("an edit of canon that is not committed is in the module, and the module is not level with the pushed branch", (check) => {
    const f = fixture("uncommitted");
    f.template.write("skeleton/LICENSE", "licence, not committed\n");
    const r = f.scaffold(["acks-one", "--title", "One"]);
    const m = f.module("acks-one");
    check("the module holds the edit, being built from the tree", m.read("LICENSE") === "licence, not committed\n", m.read("LICENSE"));
    check("the run exits 1 and names the file that differs", r.status === 1 && /drift\s+LICENSE\n/u.test(r.out), r.out);
    check("and the path of the tree that the branch does not hold", /uncommitted\s+skeleton\/LICENSE/u.test(r.out), r.out);
    check("the last line names the command that writes the pushed branch over it", /^not level: /u.test(r.last) && r.last.includes(`sync-toolchain.mjs" --apply --repo-path "${m.dir}"`), r.last);
    const fixed = f.sync(["--apply", "--repo-path", m.dir]);
    check("and that command makes the module level", fixed.status === 0 && m.read("LICENSE") === "licence 1\n" && f.sync(["--check", "--repo-path", m.dir]).status === 0, fixed.out);

    const tree = f.scaffold(["acks-two", "--title", "Two", "--worktree"]);
    check("--worktree compares with the tree as it stands, where the module is level", tree.status === 0 && /^level: /u.test(tree.last), tree.out);
    check("and the run says the tree was read, and that it has moved", /\ncanon: this working tree at [0-9a-f]{12}, with 1 uncommitted path\(s\) of canon\n/u.test(tree.out), tree.out);
  });

  await test("an uncommitted edit in a file the sync does not write is named, though the module reads level", (check) => {
    const f = fixture("scaffold-only");
    f.template.write("skeleton/README.md", "# not committed\n");
    const r = f.scaffold(["acks-one", "--title", "One"]);
    check("the module holds the edit", f.module("acks-one").read("README.md") === "# not committed\n");
    check("the run exits 0, level in the files the sync writes", r.status === 0 && /^level: /u.test(r.last), r.out);
    check("and the path is named as one the branch does not hold", /uncommitted\s+skeleton\/README\.md/u.test(r.out), r.out);
  });

  await test("a commit that is not pushed: the module is not level with the branch, and --from compares it with the commit named", (check) => {
    const f = fixture("unpushed");
    f.template.write("skeleton/LICENSE", "licence 2\n");
    f.template.commit("canon 2, not pushed");
    const r = f.scaffold(["acks-one", "--title", "One"]);
    check("with no canon flag the run exits 1 and lists the path as committed after the branch", r.status === 1 && /committed\s+skeleton\/LICENSE/u.test(r.out) && /^not level: /u.test(r.last), r.out);
    const named = f.scaffold(["acks-two", "--title", "Two", "--from", "HEAD"]);
    check("--from HEAD compares with that commit, where the module is level", named.status === 0 && /\ncanon: [0-9a-f]{12} \(HEAD\)\n/u.test(named.out) && /^level: /u.test(named.last), named.out);
  });

  await test("a target that exists is refused and left as it was", (check) => {
    const f = fixture("exists");
    fs.mkdirSync(path.join(f.root, "acks-one"));
    fs.writeFileSync(path.join(f.root, "acks-one", "notes.txt"), "mine\n");
    const r = f.scaffold(["acks-one", "--title", "One"]);
    check("the run exits 2 and says the directory exists", r.status === 2 && /already exists/u.test(r.out), r.out);
    check("the directory holds what it held", fs.readdirSync(path.join(f.root, "acks-one")).join() === "notes.txt", fs.readdirSync(path.join(f.root, "acks-one")).join());
    check("and no rules stub is seeded for it", !fs.existsSync(path.join(f.root, "acks-rules")));
  });

  await test("an argument the script does not know is refused before anything is written", (check) => {
    const f = fixture("arguments");
    const before = fs.readdirSync(f.root).sort().join();
    for (const [what, args, says] of [
      ["a mistyped flag", ["acks-one", "--title", "One", "--worktre"], /unknown argument --worktre/u],
      ["a flag with no value", ["acks-one", "--title"], /--title takes a value/u],
      ["--from with no commit", ["acks-one", "--title", "One", "--from"], /--from takes a value/u],
      ["two canons", ["acks-one", "--title", "One", "--pushed", "--worktree"], /give one/u],
      ["no id", ["--title", "One"], /a module id is needed/u],
      ["two ids", ["acks-one", "acks-two", "--title", "One"], /one module id/u],
      ["no title", ["acks-one"], /--title is needed/u],
      ["an id that is not kebab-case", ["Acks_One", "--title", "One"], /lowercase kebab-case/u],
    ]) {
      const r = f.scaffold(args);
      check(`${what} exits 2`, r.status === 2 && says.test(r.out), r.out);
      check(`${what} writes nothing beside the template`, fs.readdirSync(f.root).sort().join() === before, fs.readdirSync(f.root).sort().join());
    }
  });

  await test("a module the check could not compare does not end as a level one does", (check) => {
    const f = fixture("no-history", { history: false });
    const r = f.scaffold(["acks-one", "--title", "One"]);
    check("with no commit to read canon from, the run exits 2", r.status === 2, r.out);
    check("the last line says the module was made and was not checked", /^not checked: .*acks-one was made/u.test(r.last), r.last);
    check("and the check's own reason is shown", /no git history of its own/u.test(r.out), r.out);
    const tree = f.scaffold(["acks-two", "--title", "Two", "--worktree"]);
    check("--worktree compares with the copy's files, where the module is level", tree.status === 0 && /^level: /u.test(tree.last), tree.out);

    // A sync that another session is halfway through writing: node exits 1 for
    // the one it cannot load, as the check does for drift, and 0 for the empty one.
    for (const [what, text] of [
      ["a sync that cannot be loaded", "this is not a script (\n"],
      ["a sync that is an empty file", ""],
    ]) {
      f.template.write("bin/sync-toolchain.mjs", text);
      const id = `acks-${what.split(" ").pop()}`;
      const broken = f.scaffold([id, "--title", "Three", "--worktree"]);
      check(`${what} leaves the module made and not checked, exit 2`, broken.status === 2 && new RegExp(`^not checked: .*${id} was made`, "u").test(broken.last), broken.out);
    }
  });

  await test("a module git would not finish does not end as a module that differs does", (check) => {
    const f = fixture("unfinished");
    // git reads the author's date only where it writes a commit, so the copy
    // and the `git add` go through and the first commit is refused.
    const r = f.scaffold(["acks-one", "--title", "One"], { GIT_AUTHOR_DATE: "not a date" });
    check("the run exits 2", r.status === 2, r.out);
    check("the last line says the module was started and not finished", /^not checked: .*acks-one was started and not finished/u.test(r.last), r.last);
    check("and git's own reason is shown", /invalid date format/u.test(r.out), r.out);
    check("the directory is left as the run left it", f.module("acks-one").read("module.json") !== null);
    const again = f.scaffold(["acks-one", "--title", "One"]);
    check("and a second run refuses it, as it does any target that exists", again.status === 2 && /already exists/u.test(again.out), again.out);
  });

  await test("this repository's own skeleton builds a module that is level with this repository's own manifest", async (check) => {
    const real = await import(url.pathToFileURL(path.join(TEMPLATE_ROOT, "manifest.mjs")).href);
    const f = fixture("real", {
      files: (dir) => {
        fs.copyFileSync(path.join(TEMPLATE_ROOT, "manifest.mjs"), path.join(dir, "manifest.mjs"));
        fs.copyFileSync(path.join(TEMPLATE_ROOT, ".gitattributes"), path.join(dir, ".gitattributes"));
        for (const rel of ["skeleton", ...real.COPY_DIRS]) fs.cpSync(path.join(TEMPLATE_ROOT, rel), path.join(dir, rel), { recursive: true });
      },
    });
    const r = f.scaffold(["acks-real", "--title", "Real", "--desc", "The skeleton as it stands."]);
    const m = f.module("acks-real");
    check("the run exits 0 and ends level", r.status === 0 && /^level: /u.test(r.last), r.out);
    const called = hooksCalled(m);
    check("every hook the module's settings start is a file in the module", called.length > 0 && called.every((rel) => m.read(rel) !== null), called.filter((rel) => m.read(rel) === null).join(", "));
    const scripts = JSON.parse(m.read("package.json")).scripts ?? {};
    check("every script the manifest enforces is in the module's package.json", Object.entries(real.CANONICAL_SCRIPTS).every(([script, command]) => scripts[script] === command), m.read("package.json"));
    check("every file the manifest lists as executable is one in the module's first commit, with nothing uncommitted", real.EXECUTABLE.length > 0 && real.EXECUTABLE.every((rel) => modeOf(m, rel) === "100755") && m.git("status", "--porcelain").trim() === "", `${m.git("ls-tree", "-r", "HEAD", "--", ...real.EXECUTABLE)}\n${m.git("status", "--porcelain")}`);
  });
} finally {
  // A check that was still writing may hold its scratch directory for a moment.
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
console.log(`\ntest-new-module: ${results.length} cases against ${path.relative(TEMPLATE_ROOT, SCRIPT) || SCRIPT}, ${failed} failed`);
process.exit(failed ? 1 : 0);
