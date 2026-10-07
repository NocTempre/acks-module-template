/**
 * Drives the `acks-commit` skill's tool against throwaway repositories and
 * checks what it exists to guarantee: a commit holds this change's hunks and
 * no peer's, the tree it commits is the tree its gate read, and a base that
 * moved under the gate is refused or carried by the stated conditions and no
 * others. Each case is a fresh repository with a gate that fails on a peer's
 * line, so a gate that read the working tree in place of the built tree is
 * red.
 *
 * Usage:  node bin/test-commit-own-hunks.mjs [<commit-own-hunks.mjs>]
 *         (defaults to .claude/skills/acks-commit/commit-own-hunks.mjs; pass a
 *         modified copy to confirm a case fails when the behaviour it guards
 *         is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const KIT = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, ".claude", "skills", "acks-commit", "commit-own-hunks.mjs"));

const BODY = Array.from({ length: 30 }, (_, n) => `line ${n + 1}`);
/**
 * The fixture's gate. It fails on a peer's line in the tree it runs in, and
 * lands a commit in the origin repository once when a flag beside the clone
 * asks for it, which is a peer's commit arriving while the gate runs.
 */
const GATE = `import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const flag = path.join(process.cwd(), "..", "land-once.json");
if (fs.existsSync(flag)) {
  const { repo, file } = JSON.parse(fs.readFileSync(flag, "utf8"));
  fs.rmSync(flag);
  fs.writeFileSync(path.join(repo, file), "landed under the gate\\n");
  execFileSync("git", ["add", "--", file], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "peer lands under the gate"], { cwd: repo });
}
for (const f of ["a.txt", "b.txt", "new.txt"]) {
  if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes("PEER")) {
    console.log("FAIL: a peer's line is in the gated tree: " + f);
    process.exit(1);
  }
}
if (process.argv[2] === "red") process.exit(1);
console.log("ok - gate " + (process.argv[2] ?? ""));
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-commit-"));
const results = [];

/** A committed repository with two text files, a file to remove, gate tooling and an untracked node_modules. */
function fixture(name, changeJson) {
  const root = path.join(tmp, name);
  const repo = path.join(root, "repo");
  const change = path.join(root, "change");
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "node_modules"), { recursive: true });
  fs.mkdirSync(change, { recursive: true });
  const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text);
  write(".gitattributes", "* text=auto eol=lf\n");
  write(".gitignore", "node_modules/\n");
  write("package.json", JSON.stringify({ scripts: { validate: "node gate.mjs validate", test: "node gate.mjs test" } }, null, 1) + "\n");
  write("gate.mjs", GATE);
  write("a.txt", BODY.join("\n") + "\n");
  write("b.txt", BODY.join("\n") + "\n");
  write("gone.txt", "to be removed\n");
  write("other.txt", "untouched\n");
  write("tools/validate.mjs", "// stands for gate tooling\n");
  write("node_modules/sentinel.txt", "must survive every clone\n");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  fs.writeFileSync(path.join(change, "commit-msg.txt"), "the change\n");
  fs.writeFileSync(path.join(change, "change.json"), JSON.stringify({ gate: ["node gate.mjs validate", "node gate.mjs test"], carry: ["node gate.mjs test"], ...changeJson }, null, 1));
  const kit = (...args) => {
    const r = spawnSync(process.execPath, [KIT, ...args, "--change", change], { cwd: repo, encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /** Rewrite numbered lines of a file in the working tree. */
  const edit = (rel, changes) => {
    const text = fs.readFileSync(path.join(repo, rel), "utf8").split("\n");
    for (const [n, value] of Object.entries(changes)) text[Number(n) - 1] = value;
    write(rel, text.join("\n"));
  };
  /** A peer's commit: one file written and committed on the shared branch. */
  const land = (rel, text) => {
    write(rel, text);
    git("add", "--", rel);
    git("commit", "-q", "-m", `peer writes ${rel}`);
  };
  /** `record`, as a session does before it reads the listing, then `ship`. */
  const ship = () => {
    const recorded = kit("record");
    return recorded.status === 0 ? kit("ship") : recorded;
  };
  return { repo, change, git, kit, ship, edit, write, land, head: () => git("rev-parse", "HEAD").trim(), show: (rel) => git("show", `HEAD:${rel}`) };
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

const OWN_A = { files: { "a.txt": { own: "MINE", count: 1 } } };

try {
  test("a commit holds this change's hunk, and the peer's hunk stays in the working tree", (check) => {
    const f = fixture("hunks", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    const base = f.head();
    const shipped = f.ship();
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the listing names one hunk as MINE and one as left", /MINE -3,1/.test(shipped.out) && /left -20,1/.test(shipped.out), shipped.out);
    check("HEAD holds the change's line", f.show("a.txt").includes("line 3 MINE"));
    check("HEAD holds no peer line", !f.show("a.txt").includes("PEER"));
    check("the commit's parent is the base", f.git("rev-parse", "HEAD~1").trim() === base);
    check("the working tree still differs from HEAD by the peer's hunk alone", f.git("diff", "-U0", "HEAD").includes("+line 20 PEER") && !f.git("diff", "-U0", "HEAD").includes("MINE"));
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
    check("the linked node_modules survives the clone", fs.existsSync(path.join(f.repo, "node_modules", "sentinel.txt")));
    f.kit("clean");
    check("clean removes the clone and leaves node_modules", !fs.existsSync(path.join(f.change, "clone")) && fs.existsSync(path.join(f.repo, "node_modules", "sentinel.txt")));
  });

  test("a whole file, an added file and a removed file commit together under package.json's gate", (check) => {
    const f = fixture("whole", { files: { "b.txt": { whole: true } }, added: ["new.txt"], removed: ["gone.txt"], gate: undefined });
    f.edit("b.txt", { 5: "line 5 changed", 25: "line 25 changed" });
    f.write("new.txt", "a new file\n");
    fs.rmSync(path.join(f.repo, "gone.txt"));
    f.edit("a.txt", { 9: "line 9 PEER" });
    const shipped = f.ship();
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the default gate ran validate and the tests through npm", /npm run validate: exit 0/.test(shipped.out) && /npm test: exit 0/.test(shipped.out), shipped.out);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",");
    check("the commit writes exactly the three paths", names === "b.txt,gone.txt,new.txt", names);
    check("the peer's file is still modified and uncommitted", f.git("status", "--porcelain").trim() === "M a.txt", f.git("status", "--porcelain"));
  });

  test("a whole-listed file a peer has written in is refused at record", (check) => {
    const f = fixture("whole-foreign", { files: { "b.txt": { whole: true, own: "MINE" } } });
    f.edit("b.txt", { 5: "line 5 MINE", 25: "line 25 PEER" });
    const r = f.kit("record");
    check("record exits 1", r.status === 1, r.out);
    check("it says a hunk does not match", /listed whole, and 1 hunk\(s\) do not match/.test(r.out), r.out);
  });

  test("a whole-listed file edited after record is refused at commit", (check) => {
    const f = fixture("whole-edited", { files: { "b.txt": { whole: true } } });
    f.edit("b.txt", { 5: "line 5 changed" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.edit("b.txt", { 6: "line 6 changed later" });
    const base = f.head();
    const r = f.kit("commit");
    check("commit exits 1 and names the file's changed content", r.status === 1 && /b\.txt: listed whole, and its working copy is/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
  });

  test("a change recorded again after its gate is not the gated tree", (check) => {
    const f = fixture("rerecorded", { files: { "b.txt": { whole: true } } });
    f.edit("b.txt", { 5: "line 5 changed" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.edit("b.txt", { 6: "a wording fix after the gate" });
    check("the second record is green", f.kit("record").status === 0);
    const base = f.head();
    const r = f.kit("commit");
    check("commit exits 1 and says the tree is not the one that passed", r.status === 1 && /the tree is now [0-9a-f]{40}, and [0-9a-f]{40} is what passed/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
  });

  test("a pattern that picks more hunks than the change wrote is refused at record", (check) => {
    const f = fixture("count", { files: { "a.txt": { own: "line", count: 1 } } });
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    const r = f.kit("record");
    check("record exits 1 and gives both counts", r.status === 1 && /the pattern picks 2 hunk\(s\) and 1 are this change's/.test(r.out), r.out);
  });

  test("ship starts from a record, and holds a whole-listed file to it", (check) => {
    const f = fixture("ship-pin", { files: { "b.txt": { whole: true } } });
    f.edit("b.txt", { 5: "line 5 changed" });
    const base = f.head();
    const bare = f.kit("ship");
    check("ship with no record exits 1", bare.status === 1 && /run `record` and read its listing first/.test(bare.out), bare.out);
    check("record is green", f.kit("record").status === 0);
    f.edit("b.txt", { 6: "line 6 PEER, written after the listing was read" });
    const r = f.kit("ship");
    check("ship exits 1 on the later edit", r.status === 1 && /not what the last `record` hashed/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
  });

  test("a peer's hunk taken into the gated tree makes the gate red, and nothing is recorded", (check) => {
    const f = fixture("gate-red", { files: { "a.txt": { own: "line", count: 2 } } });
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    f.kit("record");
    const r = f.kit("gate");
    check("gate exits 1", r.status === 1, r.out);
    check("no gated tree is recorded", !fs.existsSync(path.join(f.change, "gated.json")));
    check("commit refuses with no gated tree", f.kit("commit").status === 1);
  });

  test("a gate that exits 0 without the expected line is not green", (check) => {
    const f = fixture("expect", { ...OWN_A, expect: ["ok - the check that never printed"] });
    f.edit("a.txt", { 3: "line 3 MINE" });
    f.kit("record");
    const r = f.kit("gate");
    check("gate exits 1", r.status === 1, r.out);
    check("it names the absent line", /expected in the gate's output and absent/.test(r.out), r.out);
  });

  test("a base that moved under the gate is refused with exit 3", (check) => {
    const f = fixture("moved", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("other.txt", "a peer's commit\n");
    const moved = f.head();
    const r = f.kit("commit");
    check("commit exits 3", r.status === 3, r.out);
    check("no commit is made", f.head() === moved);
  });

  test("a moved base is carried when the landed commit writes neither the change's files nor gate tooling", (check) => {
    const f = fixture("carry", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("other.txt", "a peer's commit\n");
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 0", r.status === 0, r.out);
    check("it ran the carry stage and asks for postgate", /node gate\.mjs test: exit 0 .*carry-1\.log/.test(r.out) && /run `postgate /.test(r.out), r.out);
    check("the commit's parent is the moved base", f.git("rev-parse", "HEAD~1").trim() === moved);
    check("HEAD holds the change's line and no peer line", f.show("a.txt").includes("line 3 MINE") && !f.show("a.txt").includes("PEER"));
    const post = f.kit("postgate", f.head());
    check("postgate is green on the commit", post.status === 0 && /GREEN: the full gate passes/.test(post.out), post.out);
  });

  test("a moved base is not carried when the carry stages are red on the rebuilt tree", (check) => {
    const f = fixture("carry-red", { ...OWN_A, carry: ["node gate.mjs red"] });
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("other.txt", "a peer's commit\n");
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 1 and says the stages are not green", r.status === 1 && /the carry stages are not green/.test(r.out), r.out);
    check("no commit is made", f.head() === moved);
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
  });

  test("a moved base is not carried over a commit that writes gate tooling", (check) => {
    const f = fixture("carry-tooling", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("tools/validate.mjs", "// a peer changed the gate\n");
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 3", r.status === 3, r.out);
    check("it names the tooling", /writes gate tooling \(tools\/validate\.mjs\)/.test(r.out), r.out);
    check("no commit is made", f.head() === moved);
  });

  test("a moved base is not carried over a commit that writes the change's own file", (check) => {
    const f = fixture("carry-mine", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    const mine = fs.readFileSync(path.join(f.repo, "a.txt"), "utf8");
    f.land("a.txt", BODY.map((l, n) => (n === 27 ? "line 28 landed" : l)).join("\n") + "\n");
    f.write("a.txt", mine.replace("line 28", "line 28 landed"));
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 3", r.status === 3, r.out);
    check("no commit is made", f.head() === moved);
  });

  test("ship gates again on the new base when a commit lands under its gate", (check) => {
    const f = fixture("ship-again", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    fs.writeFileSync(path.join(f.change, "land-once.json"), JSON.stringify({ repo: f.repo, file: "other.txt" }));
    const r = f.ship();
    check("ship exits 0", r.status === 0, r.out);
    check("it went again once", /the base moved under attempt 1; going again/.test(r.out) && /--- attempt 2 of 4/.test(r.out), r.out);
    check("the peer's commit is the parent", f.git("log", "-1", "--format=%s", "HEAD~1").trim() === "peer lands under the gate");
    check("HEAD holds the change's line", f.show("a.txt").includes("line 3 MINE"));
  });

  test("another session's staging in the shared index stops the run with exit 4", (check) => {
    const f = fixture("peer-staging", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    f.write("other.txt", "a peer between add and commit\n");
    f.git("add", "--", "other.txt");
    const r = f.ship();
    check("ship exits 4", r.status === 4, r.out);
    check("the peer's staging is untouched", f.git("diff", "--cached", "--name-only").trim() === "other.txt");
  });

  test("a carriage return in the content to commit is refused", (check) => {
    const f = fixture("crlf", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE\rtail" });
    f.kit("record");
    const r = f.kit("build");
    check("build exits 1", r.status === 1, r.out);
    check("it names the carriage return", /a carriage return in the content to commit/.test(r.out), r.out);
  });

  test("a change directory inside the repository is refused", (check) => {
    const f = fixture("inside", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    // A complete change, so the directory's place is the only thing to refuse.
    fs.cpSync(f.change, path.join(f.repo, "scratch"), { recursive: true });
    const r = spawnSync(process.execPath, [KIT, "record", "--change", path.join(f.repo, "scratch")], { cwd: f.repo, encoding: "utf8" });
    check("it exits 2 and says where the directory belongs", r.status === 2 && /lies outside the repository/.test(r.stderr), `${r.stdout}${r.stderr}`);
    check("nothing is recorded there", !fs.existsSync(path.join(f.repo, "scratch", "record.json")));
  });
} finally {
  // A clone a failed case left behind may still hold a link into its fixture's
  // node_modules; the fixture is deleted with it, so nothing outside is reached.
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failures = results.filter((ok) => !ok).length;
const shown = path.relative(TEMPLATE_ROOT, KIT);
console.log(`test-commit-own-hunks: ${results.length} cases against ${shown.startsWith("..") ? KIT : shown}, ${failures} failed`);
if (failures) process.exit(1);
