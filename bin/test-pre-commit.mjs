/**
 * Drives this repository's own pre-commit hook in throwaway repositories and
 * checks what it exists to guarantee: a commit made here is read by the
 * quarantine in skeleton/tools/, with the scanner beside it as the tree holds
 * it, and what the quarantine refuses is not committed.
 *
 * Usage:  node bin/test-pre-commit.mjs [--root <dir>]
 *         (`--root` is the template tree whose hook is tested and defaults to
 *         this one; pass a modified copy to confirm a case fails when the
 *         behaviour it guards is broken)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const ROOT = path.resolve(option("--root", TEMPLATE_ROOT));
const HOOK = ".githooks/pre-commit";
/** What a case's repository takes from the tree under test: the hook, and every place a quarantine could be read from. */
const CARRIED = [".githooks", "skeleton/tools", "tools"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A caller's own repository variables would turn the fixtures' git toward the
// caller's repository, and a runner has no identity to commit as.
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_PREFIX)$/iu.test(key))),
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

/** A scanner as the quarantine calls one. It flags a path that ends in /probe.txt, which the real one does not. */
const PROBE_SCANNER = `export function scanPaths(root, paths) {
  return { errors: paths.filter((p) => p.endsWith("/probe.txt")).map((p) => p + " — flagged by a scanner this case wrote"), warnings: [] };
}
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-pre-commit-test-"));
const results = [];

/**
 * A repository that holds the hook and the tools of the tree under test, with
 * the hook armed as this repository arms it. `before` writes what the first
 * commit holds beside them; that commit is made before the hook is armed.
 */
function fixture(name, before = () => {}) {
  const dir = path.join(tmp, name);
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: ENV });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  fs.mkdirSync(dir);
  for (const rel of CARRIED) {
    if (fs.existsSync(path.join(ROOT, rel))) fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  before(write);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  // Git on Linux and macOS runs a hook only where its file is executable, and
  // a checkout there gives this one the mode the index holds for it.
  if (fs.existsSync(path.join(dir, HOOK))) fs.chmodSync(path.join(dir, HOOK), 0o755);
  git("config", "core.hooksPath", ".githooks");
  /** Stage the paths and commit them, with git run in `sub`. */
  const commit = (sub, ...paths) => {
    git("add", "--", ...paths);
    const r = spawnSync("git", ["commit", "-m", "a commit"], { cwd: path.join(dir, sub), encoding: "utf8", env: ENV });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const head = () => git("rev-parse", "HEAD").stdout.trim();
  /** The paths the last commit writes, sorted. */
  const written = () => git("show", "--name-only", "--format=", "HEAD").stdout.trim().split("\n").sort().join(", ");
  const exclude = () => fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  return { dir, git, write, commit, head, written, exclude };
}

function test(name, body) {
  const problems = [];
  const check = (what, ok, detail = "") => {
    if (!ok) problems.push(`${what}${detail ? `\n      ${String(detail).trim().split("\n").join("\n      ")}` : ""}`);
  };
  try {
    body(check);
  } catch (e) {
    problems.push(`threw: ${e.stack ?? e}`);
  }
  results.push(problems.length === 0);
  console.log(problems.length ? `FAIL ${name}\n  ${problems.join("\n  ")}` : `ok   ${name}`);
}

try {
  test("a banned path staged beside a clean file stays out of the commit, wherever in the tree git is run", (check) => {
    const f = fixture("quarantine");
    f.write("ruledata/table.json", "{}\n");
    f.write("docs/note.txt", "clean\n");
    const base = f.head();
    const made = f.commit("docs", "ruledata/table.json", "docs/note.txt");
    check("git commit exits 0", made.status === 0, made.out);
    check("the quarantine names the path it took out", /LEAK {2}ruledata\/table\.json/u.test(made.out) && /Quarantined 1 file\(s\)/u.test(made.out), made.out);
    check("a commit is made, and it writes the clean file alone", f.head() !== base && f.written() === "docs/note.txt", f.written());
    check("the banned file is still on disk", fs.existsSync(path.join(f.dir, "ruledata", "table.json")));
    check("git ignores it from here on, by the list no commit carries", f.exclude().split("\n").includes("ruledata/table.json"), f.exclude());
  });

  test("the scanner that reads a commit is skeleton/tools/ip-scan.mjs as the tree holds it", (check) => {
    const f = fixture("in-place");
    f.write("first/probe.txt", "x\n");
    const control = f.commit("", "first/probe.txt");
    check("a name no rule bans is committed", control.status === 0 && f.written() === "first/probe.txt", control.out);
    // A rule for that name, written into the skeleton's scanner and nowhere else.
    f.write("skeleton/tools/ip-scan.mjs", PROBE_SCANNER);
    f.write("second/probe.txt", "x\n");
    f.write("second/clean.txt", "x\n");
    const made = f.commit("", "second/probe.txt", "second/clean.txt");
    check("git commit exits 0", made.status === 0, made.out);
    check("the rule takes the name out of the next commit, with no other file written", f.written() === "second/clean.txt", `${f.written()}\n${made.out}`);
  });

  test("a change to a banned file HEAD already holds stops the commit", (check) => {
    const f = fixture("in-head", (write) => write("ruledata/old.json", "{}\n"));
    f.write("ruledata/old.json", '{ "changed": true }\n');
    f.write("docs/note.txt", "clean\n");
    const base = f.head();
    const made = f.commit("", "ruledata/old.json", "docs/note.txt");
    check("git commit exits with the quarantine's refusal", made.status !== 0 && /ALREADY COMMITTED/u.test(made.out), made.out);
    check("no commit is made", f.head() === base);
  });

  test("this tree holds no copy of a skeleton tool at its root", (check) => {
    const canon = fs.readdirSync(path.join(ROOT, "skeleton", "tools")).filter((name) => name.endsWith(".mjs"));
    const copies = canon.filter((name) => fs.existsSync(path.join(ROOT, "tools", name)));
    check("skeleton/tools/ holds the quarantine and its scanner", ["ip-quarantine.mjs", "ip-scan.mjs"].every((name) => canon.includes(name)), canon.join(", "));
    // The commit tool asks a scanner in tools/ ahead of the one this hook runs.
    check("tools/ holds none of them", copies.length === 0, copies.map((name) => `tools/${name}`).join(", "));
  });
} finally {
  // A git that was still exiting may hold its directory for a moment.
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
console.log(`\ntest-pre-commit: ${results.length} cases against ${path.relative(TEMPLATE_ROOT, path.join(ROOT, HOOK)) || HOOK}, ${failed} failed`);
process.exit(failed ? 1 : 0);
