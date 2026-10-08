/**
 * Drives the `acks-commit` skill's tool against throwaway repositories and
 * checks what it exists to guarantee: a commit holds this change's hunks and
 * no peer's, the tree it commits is the tree its gate read, and a base that
 * moved under the gate is refused or carried by the stated conditions and no
 * others. Each case is a fresh repository with a gate that fails on a peer's
 * line, so a gate that read the working tree in place of the built tree is
 * red. The ledger cases write through the edit-ledger hook as two sessions
 * and check that a line is taken by its writer and by nobody else.
 *
 * Usage:  node bin/test-commit-own-hunks.mjs [<commit-own-hunks.mjs>] [--group tree|ledger]
 *         (defaults to .claude/skills/acks-commit/commit-own-hunks.mjs; pass a
 *         modified copy to confirm a case fails when the behaviour it guards
 *         is broken. A copy imports `ledger.mjs` from beside itself.
 *         `--group` runs the shared-tree cases or the ledger's alone)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const GROUP = process.argv.includes("--group") ? process.argv[process.argv.indexOf("--group") + 1] : null;
const KIT = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(TEMPLATE_ROOT, ".claude", "skills", "acks-commit", "commit-own-hunks.mjs"));
const HOOK = path.join(TEMPLATE_ROOT, ".claude", "hooks", "edit-ledger.mjs");
const ME = "session-me-0001";
const PEER = "session-peer-0002";

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

/**
 * A committed repository with two text files, a file to remove, gate tooling
 * and an untracked node_modules. The tool runs as `session`, or as no session
 * at all: the id this test's own shell carries never reaches it.
 */
function fixture(name, changeJson, { session = null } = {}) {
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
  // The ledger hook records only where the commit tool is carried.
  fs.mkdirSync(path.join(repo, ".claude", "skills", "acks-commit"), { recursive: true });
  write(".claude/skills/acks-commit/commit-own-hunks.mjs", "// stands for the commit tool\n");
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
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (session) env.CLAUDE_CODE_SESSION_ID = session;
  const kit = (...args) => {
    const r = spawnSync(process.execPath, [KIT, ...args, "--change", change], { cwd: repo, encoding: "utf8", env });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /** Rewrite change.json, keeping the fixture's gate. */
  const rechange = (json) => fs.writeFileSync(path.join(change, "change.json"), JSON.stringify({ gate: ["node gate.mjs validate", "node gate.mjs test"], carry: ["node gate.mjs test"], ...json }, null, 1));
  /** Rewrite numbered lines of a file in the working tree. */
  const edit = (rel, changes) => {
    const text = fs.readFileSync(path.join(repo, rel), "utf8").split("\n");
    for (const [n, value] of Object.entries(changes)) text[Number(n) - 1] = value;
    write(rel, text.join("\n"));
  };
  /**
   * A session writing through the Edit and Write tools: the file is written,
   * then the ledger hook is told, as Claude Code tells it.
   */
  const as = (who) => {
    const through = (rel, next) => {
      const file = path.join(repo, rel);
      const pre = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      fs.writeFileSync(file, next);
      const tool_response = pre === null ? { type: "create", filePath: file, originalFile: null, structuredPatch: [] } : { filePath: file, originalFile: pre, structuredPatch: [] };
      const payload = { session_id: who, hook_event_name: "PostToolUse", cwd: repo, tool_name: pre === null ? "Write" : "Edit", tool_input: { file_path: file }, tool_response };
      const r = spawnSync(process.execPath, [HOOK], { cwd: repo, input: JSON.stringify(payload), encoding: "utf8" });
      if (r.status !== 0 || r.stdout || r.stderr) throw new Error(`the ledger hook exited ${r.status} and printed: ${r.stdout}${r.stderr}`);
    };
    return {
      write: through,
      edit: (rel, changes) => {
        const text = fs.readFileSync(path.join(repo, rel), "utf8").split("\n");
        for (const [n, value] of Object.entries(changes)) text[Number(n) - 1] = value;
        through(rel, text.join("\n"));
      },
      append: (rel, more) => through(rel, fs.readFileSync(path.join(repo, rel), "utf8") + more),
    };
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
  return { repo, change, git, kit, ship, edit, write, land, as, rechange, head: () => git("rev-parse", "HEAD").trim(), show: (rel) => git("show", `HEAD:${rel}`) };
}

function test(name, body, group = "tree") {
  if (GROUP && GROUP !== group) return;
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
    check("ship with no record lists the change and exits 1", bare.status === 1 && /== b\.txt: 1 hunk\(s\), 1 this change's, taken whole/.test(bare.out) && /read it, then run `ship` again/.test(bare.out), bare.out);
    check("no commit is made by it", f.head() === base);
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

  // --- the edit ledger ---

  const ledgerCase = (name, body) => test(name, body, "ledger");
  const working = (f) => f.git("diff", "-U0", "HEAD");

  ledgerCase("a file listed with no pattern gives up the hunks the ledger says this session wrote, and ship needs no listing read", (check) => {
    const f = fixture("ledger-own", { files: { "a.txt": {} } }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(PEER).edit("a.txt", { 20: "line 20 PEER" });
    f.as(ME).edit("a.txt", { 27: "line 27 by me" });
    const shipped = f.kit("ship");
    check("ship exits 0 with no record made first", shipped.status === 0, shipped.out);
    check("the listing says whose each hunk is", /MINE -3,1 \(-1 \+1\) \[me\]/.test(shipped.out) && /left -20,1 \(-1 \+1\) \[session session-\]/.test(shipped.out) && /MINE -27,1/.test(shipped.out), shipped.out);
    check("HEAD holds both of this session's lines", f.show("a.txt").includes("line 3 by me") && f.show("a.txt").includes("line 27 by me"));
    check("HEAD holds no peer line", !f.show("a.txt").includes("PEER"));
    check("the peer's hunk alone is left in the working tree", working(f).includes("+line 20 PEER") && !working(f).includes("by me"), working(f));
  });

  ledgerCase("a file this session alone has written is taken entire, however git pairs its lines into hunks", (check) => {
    const f = fixture("ledger-sole", {}, { session: ME });
    f.write("a.txt", "first\n\nsecond\n\n\nthird\n");
    f.git("commit", "-q", "-am", "paragraphs");
    // Two edits git reads as a line replaced and a line moved.
    f.as(ME).write("a.txt", "first\n\nnew\n\nsecond\n\n\nthird\n");
    f.as(ME).write("a.txt", "first\n\nnew\n\nsecond\n\nthird\n");
    const shipped = f.kit("ship");
    check("ship exits 0 with no record made first", shipped.status === 0, shipped.out);
    check("HEAD holds the file as the working tree does", f.show("a.txt") === "first\n\nnew\n\nsecond\n\nthird\n" && working(f) === "", f.show("a.txt"));
  });

  ledgerCase("a change written before the ledger's first record of a file is nobody's", (check) => {
    const f = fixture("ledger-before", {}, { session: ME });
    // No hook saw this one, and the file's first record finds it already there.
    f.edit("a.txt", { 20: "line 20 PEER, from before the ledger" });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const first = f.kit("ship");
    check("ship stops with the earlier hunk left", first.status === 1 && /MINE -3,1 \(-1 \+1\) \[me\]/.test(first.out) && /left -20,1 \(-1 \+1\) \[no record\]/.test(first.out), first.out);
    const second = f.kit("ship");
    check("ship run again commits this session's line alone", second.status === 0 && f.show("a.txt").includes("line 3 by me") && !f.show("a.txt").includes("PEER"), second.out);
  });

  ledgerCase("a change that names no path is every file this session wrote, and no file a peer wrote", (check) => {
    const f = fixture("ledger-auto", {}, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(ME).write("new.txt", "a new file by me\n");
    f.as(PEER).edit("b.txt", { 5: "line 5 PEER" });
    f.as(PEER).write("theirs.txt", "a new file, PEER's\n");
    f.as(ME).edit("other.txt", { 1: "changed by me" });
    f.as(ME).edit("other.txt", { 1: "untouched" });
    // A file this session created and a peer has since rewritten.
    f.as(ME).write("taken-over.txt", "by me\n");
    f.as(PEER).write("taken-over.txt", "rewritten, PEER's now\n");
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",");
    check("the commit writes this session's two files", names === "a.txt,new.txt", names);
    const status = f.git("status", "--porcelain").trim().split("\n").map((l) => l.trim()).sort().join("|");
    check("the peer's files are as they were", status === "?? taken-over.txt|?? theirs.txt|M b.txt", status);
  });

  ledgerCase("a new file holding lines that are not this session's is not added on the ledger's word", (check) => {
    const f = fixture("ledger-new-mixed", {}, { session: ME });
    f.as(ME).write("new.txt", "by me\nalso by me\n");
    f.write("new.txt", "by me\nalso by me\na line by a script\n");
    const r = f.kit("record");
    check("record exits 1 and counts the lines", r.status === 1 && /REFUSED: new\.txt: new, and 1 of its 3 line\(s\) are not this session's by the ledger/.test(r.out), r.out);
    f.rechange({ added: ["new.txt"] });
    check("named under added, it is taken whole", f.kit("record").status === 0);
  });

  ledgerCase("a hunk two readings give to different sessions is not taken by a pattern", (check) => {
    const f = fixture("ledger-among", { files: { "a.txt": { own: "same" } } }, { session: ME });
    f.write("a.txt", "top\nsame\nsame\nbottom\n");
    f.git("commit", "-q", "-am", "two equal lines");
    f.as(PEER).write("a.txt", "top\nsame\nbottom\n");
    f.as(ME).write("a.txt", "top\nbottom\n");
    const r = f.kit("record");
    check("record exits 1 and names the other session", r.status === 1 && /the pattern picks a hunk, and the ledger gives session- a line in it/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": {} } });
    const bare = f.kit("record");
    check("and the ledger gives this session none of it", bare.status === 1 && /the ledger gives this session none of its hunks/.test(bare.out), bare.out);
  });

  ledgerCase("two sessions' entries appended one after the other commit apart, each its own lines", (check) => {
    const f = fixture("ledger-joined", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).append("a.txt", "## theirs\na PEER entry\n");
    f.as(ME).append("a.txt", "## mine\nmy entry\n");
    const recorded = f.kit("record");
    check("record divides the one hunk", recorded.status === 0 && /PART -30,0 \(-0 \+4\) \[me \+ session session-\]/.test(recorded.out), recorded.out);
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("HEAD ends with this session's entry and holds no peer line", f.show("a.txt").endsWith("line 30\n## mine\nmy entry\n"), f.show("a.txt").slice(-80));
    check("the peer's entry alone is left, ahead of this session's", /^\+## theirs\n\+a PEER entry$/m.test(working(f)) && !working(f).includes("+## mine"), working(f));
  });

  ledgerCase("a pattern cannot take a hunk the ledger gives another session", (check) => {
    const f = fixture("ledger-veto", { files: { "a.txt": { own: "line" } } }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(PEER).edit("a.txt", { 20: "line 20 PEER" });
    const r = f.kit("record");
    check("record exits 1 and names the session", r.status === 1 && /the pattern picks a hunk, and the ledger gives session- a line in it/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": { whole: true } } });
    const whole = f.kit("record");
    check("a whole file is refused the same way", whole.status === 1 && /listed whole, and the ledger gives session- a line in it/.test(whole.out), whole.out);
    f.as(PEER).write("new.txt", "a new file, PEER's\n");
    f.rechange({ files: { "a.txt": { own: "by me" } }, added: ["new.txt"] });
    const added = f.kit("record");
    check("so is a named new file", added.status === 1 && /new\.txt: added, and the ledger gives session- a line in it/.test(added.out), added.out);
  });

  ledgerCase("a hunk no record accounts for is left, and ship stops for its listing to be read", (check) => {
    const f = fixture("ledger-gap", {}, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    // A writer no hook saw, between two of this session's edits.
    f.edit("a.txt", { 10: "line 10 PEER, by a script" });
    f.as(ME).edit("a.txt", { 15: "line 15 by me" });
    const base = f.head();
    const first = f.kit("ship");
    check("ship stops with the hunk listed as nobody's", first.status === 1 && /left -10,1 \(-1 \+1\) \[no record\]/.test(first.out) && /read it, then run `ship` again/.test(first.out), first.out);
    check("no commit is made", f.head() === base);
    const second = f.kit("ship");
    check("ship run again exits 0", second.status === 0, second.out);
    check("HEAD holds this session's two lines and not the script's", f.show("a.txt").includes("line 3 by me") && f.show("a.txt").includes("line 15 by me") && !f.show("a.txt").includes("PEER"));
    check("the script's line is still in the working tree", working(f).includes("+line 10 PEER, by a script"));
  });

  ledgerCase("this session's line beside one no record accounts for is refused until a pattern claims the hunk", (check) => {
    const f = fixture("ledger-beside", { files: { "a.txt": {} } }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me", 20: "line 20 by me" });
    f.edit("a.txt", { 4: "line 4, by a script" });
    const r = f.kit("record");
    check("record exits 1 and says what the hunk holds", r.status === 1 && /REFUSED: a\.txt: the hunk at -3 holds this session's lines beside 2 no record accounts for/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": { own: "by me", count: 2 } } });
    const claimed = f.kit("record");
    check("a pattern takes it", claimed.status === 0 && /MINE -3,2 \(-2 \+2\) \[me \+ no record\]/.test(claimed.out), claimed.out);
    // Added lines alone: nothing of the hunk is divided off while a line in it has no writer.
    const g = fixture("ledger-beside-added", { files: { "a.txt": {} } }, { session: ME });
    g.as(ME).append("a.txt", "an entry by me\n");
    g.write("a.txt", `${fs.readFileSync(path.join(g.repo, "a.txt"), "utf8")}a line by a script\n`);
    const added = g.kit("record");
    check("a hunk of added lines is held the same way", added.status === 1 && /REFUSED: a\.txt: the hunk at -30 holds this session's lines beside 1 no record accounts for/.test(added.out), added.out);
  });

  ledgerCase("another session's records count as this one's only under adopt", (check) => {
    const f = fixture("ledger-adopt", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).edit("a.txt", { 3: "line 3 by the session before" });
    const r = f.kit("record");
    check("record exits 1 with none of the hunks this session's", r.status === 1 && /the ledger gives this session none of its hunks/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": {} }, adopt: ["session"] });
    const loose = f.kit("record");
    check("a prefix under eight characters is refused", loose.status === 2 && /give eight characters or more/.test(loose.out), loose.out);
    f.rechange({ files: { "a.txt": {} }, adopt: [PEER.slice(0, 12)] });
    const bare = f.kit("ship");
    check("ship stops for the listing, the hunk taken", bare.status === 1 && /MINE -3,1 \(-1 \+1\) \[me\]/.test(bare.out) && /read it, then run `ship` again/.test(bare.out), bare.out);
    const shipped = f.kit("ship");
    check("ship run again commits it", shipped.status === 0 && f.show("a.txt").includes("line 3 by the session before"), shipped.out);
  });

  ledgerCase("with no session id a pattern is read as before, and the ledger only labels", (check) => {
    const f = fixture("ledger-no-session", { files: { "a.txt": { own: "by a session", count: 1 } } });
    f.as(PEER).edit("a.txt", { 3: "line 3 by a session" });
    const r = f.kit("record");
    check("record takes the hunk and labels its writer", r.status === 0 && /MINE -3,1 \(-1 \+1\) \[session session-\]/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": {} } });
    const bare = f.kit("record");
    check("a file with no pattern is refused", bare.status === 2 && /no session id says whose edits the ledger gives/.test(bare.out), bare.out);
    f.rechange({});
    const none = f.kit("record");
    check("so is a change that names no path", none.status === 2 && /change\.json names no path, and no session id/.test(none.out), none.out);
  });

  ledgerCase("a session with nothing of its own in the working tree has nothing to commit", (check) => {
    const f = fixture("ledger-empty", {}, { session: ME });
    f.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    const r = f.kit("record");
    check("record exits 1", r.status === 1 && /nothing in the working tree is this session's to commit/.test(r.out), r.out);
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
