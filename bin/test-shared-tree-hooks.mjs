/**
 * Drives the two shared-tree hooks and the ledger's reader against throwaway
 * repositories and checks what each exists to guarantee:
 *
 * - `edit-ledger.mjs`, fed payloads shaped as the Edit and Write tools report
 *   them, records a write only with a `pre` it can stand behind;
 * - `ledger.mjs`, over what the hook wrote, gives a line to the session that
 *   wrote it and to nobody when a writer no hook saw came between;
 * - `shared-tree-guard.mjs` denies the hand-run git commands that go around
 *   the commit tool, in the repositories it guards and nowhere else.
 *
 * Usage:  node bin/test-shared-tree-hooks.mjs [--hook <edit-ledger.mjs>] [--reader <ledger.mjs>] [--guard <shared-tree-guard.mjs>]
 *         (each defaults to the copy in this repository; pass a modified copy
 *         to confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const option = (name, fallback) => path.resolve(process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : path.join(TEMPLATE_ROOT, fallback));
const HOOK = option("--hook", ".claude/hooks/edit-ledger.mjs");
const READER = option("--reader", ".claude/skills/acks-commit/ledger.mjs");
const GUARD = option("--guard", ".claude/hooks/shared-tree-guard.mjs");
const TOOL = ".claude/skills/acks-commit/commit-own-hunks.mjs";

const { blame, writersOf, soleWriter, readRecords, prune, ORIGIN, NOBODY } = await import(url.pathToFileURL(READER).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-hooks-"));
const results = [];
const BODY = Array.from({ length: 12 }, (_, n) => `line ${n + 1}`);
const ME = "session-me";
const PEER = "session-peer";

/**
 * The patch the Edit and Write tools report for a change in one place: one
 * hunk with up to three lines of context either side.
 */
function patchOf(pre, next) {
  const a = pre.split("\n");
  const b = next.split("\n");
  if (a[a.length - 1] === "") a.pop();
  if (b[b.length - 1] === "") b.pop();
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  if (head === a.length && head === b.length) return [];
  const before = Math.min(3, head);
  const after = Math.min(3, tail);
  const lines = [
    ...a.slice(head - before, head).map((l) => ` ${l}`),
    ...a.slice(head, a.length - tail).map((l) => `-${l}`),
    ...b.slice(head, b.length - tail).map((l) => `+${l}`),
    ...a.slice(a.length - tail, a.length - tail + after).map((l) => ` ${l}`),
  ];
  return [{ oldStart: head - before + 1, oldLines: before + (a.length - tail - head) + after, newStart: head - before + 1, newLines: before + (b.length - tail - head) + after, lines }];
}

/** A committed repository holding `a.txt`, with the stand-ins a case asks for. */
function fixture(name, { origin = null, tool = true } = {}) {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo, { recursive: true });
  const abs = (rel) => path.join(repo, rel);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  fs.writeFileSync(abs(".gitattributes"), "* text=auto eol=lf\n");
  fs.writeFileSync(abs(".gitignore"), "local/\n");
  fs.writeFileSync(abs("a.txt"), `${BODY.join("\n")}\n`);
  if (tool) {
    fs.mkdirSync(path.dirname(abs(TOOL)), { recursive: true });
    fs.writeFileSync(abs(TOOL), "// stands for the commit tool\n");
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  if (origin) git("remote", "add", "origin", origin);
  const gitDir = abs(".git");
  const read = (rel) => fs.readFileSync(abs(rel), "utf8");

  /** Run the ledger hook with one payload and answer what it printed and how it ended. */
  const hook = (payload, cwd = repo) => {
    const r = spawnSync(process.execPath, [HOOK], { cwd, input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /**
   * One Edit or Write as a session makes it: the file is written, then the
   * hook is told. `shape` picks what the tool's result carries.
   */
  const write = (session, rel, next, shape = "original", extra = {}) => {
    const pre = fs.existsSync(abs(rel)) ? read(rel) : null;
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), next);
    const payload = { session_id: session, hook_event_name: "PostToolUse", cwd: repo, tool_name: "Edit", tool_input: { file_path: abs(rel) }, tool_response: { filePath: abs(rel) } };
    const patch = pre === null ? [] : patchOf(pre, next);
    if (pre === null) Object.assign(payload, { tool_name: "Write", tool_response: { type: "create", filePath: abs(rel), content: next, structuredPatch: [], originalFile: null } });
    else if (shape === "original") Object.assign(payload.tool_response, { originalFile: pre, structuredPatch: patch });
    else if (shape === "patch") Object.assign(payload.tool_response, { originalFile: null, structuredPatch: patch });
    else if (shape === "truncated") Object.assign(payload.tool_response, { originalFile: pre.split("\n").slice(0, 4).join("\n"), structuredPatch: patch });
    else if (shape === "misfit") Object.assign(payload.tool_response, { originalFile: null, structuredPatch: patch.map((h) => ({ ...h, newStart: h.newStart + 1 })) });
    else if (shape === "replace") Object.assign(payload.tool_input, extra);
    Object.assign(payload, extra.payload ?? {});
    delete payload.tool_input.payload;
    const r = hook(payload);
    if (r.status !== 0 || r.out) throw new Error(`the ledger hook exited ${r.status} and printed: ${r.out}`);
  };
  /** A write no hook sees: a script, a formatter, a session older than the hook. */
  const unseen = (rel, next) => fs.writeFileSync(abs(rel), next);
  /** Lines of a file with numbered lines replaced, removed (null) or followed by more (an array). */
  const change = (rel, changes) => {
    const out = [];
    read(rel).replace(/\n$/, "").split("\n").forEach((line, i) => {
      const to = changes[i + 1];
      if (to === undefined) out.push(line);
      else if (Array.isArray(to)) out.push(line, ...to);
      else if (to !== null) out.push(to);
    });
    return `${out.join("\n")}\n`;
  };
  /** The working tree's zero-context hunks against HEAD, as the commit tool reads them. */
  const hunks = (rel) => {
    const out = [];
    for (const line of git("diff", "-U0", "--no-color", "HEAD", "--", rel).split("\n")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) out.push({ newStart: Number(m[3]), plus: [], minus: [] });
      else if (out.length && line.startsWith("+")) out[out.length - 1].plus.push(line.slice(1));
      else if (out.length && line.startsWith("-")) out[out.length - 1].minus.push(line.slice(1));
    }
    return out;
  };
  const blamed = (rel) => blame(gitDir, rel, read(rel));
  /** The writers of every hunk of a file, one entry per hunk. */
  const writers = (rel) => {
    const b = blamed(rel);
    return hunks(rel).map((h) => writersOf(b, h));
  };
  return { repo, abs, git, gitDir, read, hook, write, unseen, change, hunks, blamed, writers };
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
  results.push(!problems.length);
  console.log(`${problems.length ? "FAIL" : "ok"} - ${name}`);
  for (const p of problems) console.log(`    ${p}`);
}

const all = (list, value) => list.length > 0 && list.every((w) => w === value);
const show = (v) => JSON.stringify(v);

try {
  // --- the ledger: what the hook records and what the reader makes of it ---

  for (const shape of ["original", "patch"]) {
    test(`a session's edit is its own, by the tool's ${shape === "original" ? "copy of the file" : "patch undone"}`, (check) => {
      const f = fixture(`own-${shape}`);
      f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE", 7: ["added by me"] }), shape);
      const w = f.writers("a.txt");
      check("two hunks", w.length === 2, show(w));
      check("the replacement is this session's, both sides", all(w[0].added, ME) && all(w[0].removed, ME), show(w[0]));
      check("the insertion is this session's", all(w[1].added, ME) && w[1].removed.length === 0, show(w[1]));
      const b = f.blamed("a.txt");
      check("a line nobody touched is older than the ledger", b.owners[0] === ORIGIN && b.owners[4] === ORIGIN, show(b.owners));
      check("the record says how its `pre` was found", readRecords(f.gitDir).get("a.txt")[0].how === shape, show(readRecords(f.gitDir).get("a.txt")));
    });
  }

  test("two sessions in one file each keep their own lines", (check) => {
    const f = fixture("two");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 9: "line 9 PEER" }));
    f.write(ME, "a.txt", f.change("a.txt", { 5: "line 5 MINE" }));
    const w = f.writers("a.txt");
    check("three hunks", w.length === 3, show(w));
    check("line 3 is this session's", all(w[0].added, ME), show(w[0]));
    check("line 5 is this session's", all(w[1].added, ME), show(w[1]));
    check("line 9 is the peer's, both sides", all(w[2].added, PEER) && all(w[2].removed, PEER), show(w[2]));
  });

  test("a writer no hook saw is nobody, and the next session's record does not take its lines", (check) => {
    const f = fixture("unseen");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.unseen("a.txt", f.change("a.txt", { 6: "line 6 UNSEEN", 10: null }));
    f.write(ME, "a.txt", f.change("a.txt", { 8: "line 8 MINE" }));
    const w = f.writers("a.txt");
    check("four hunks", w.length === 4, show(w));
    check("line 3 is this session's", all(w[0].added, ME), show(w[0]));
    check("the unseen replacement is nobody's, both sides", all(w[1].added, NOBODY) && all(w[1].removed, NOBODY), show(w[1]));
    check("line 8 is this session's", all(w[2].added, ME), show(w[2]));
    check("the unseen removal is nobody's", w[3].added.length === 0 && all(w[3].removed, NOBODY), show(w[3]));
  });

  test("a write after the last record is nobody's", (check) => {
    const f = fixture("after");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.unseen("a.txt", f.change("a.txt", { 3: "line 3 MINE, then reformatted" }));
    const w = f.writers("a.txt");
    check("the line a script rewrote is not this session's", all(w[0].added, NOBODY), show(w[0]));
  });

  test("a record with no `pre` gives its whole write to nobody", (check) => {
    const f = fixture("no-pre");
    f.unseen("a.txt", f.change("a.txt", { 9: "line 9 PEER, uncommitted" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "none");
    const w = f.writers("a.txt");
    check("the record holds no `pre`", readRecords(f.gitDir).get("a.txt")[0].pre === null);
    check("neither hunk is this session's", w.every((h) => !h.added.includes(ME)), show(w));
  });

  test("a copy of the original that is not the whole file is not believed", (check) => {
    const f = fixture("truncated");
    f.unseen("a.txt", f.change("a.txt", { 9: "line 9 PEER, uncommitted" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "truncated");
    const rec = readRecords(f.gitDir).get("a.txt")[0];
    check("the record holds no `pre`", rec.pre === null && rec.how === "none", show(rec));
    check("the peer's line is not this session's", f.writers("a.txt").every((h) => !h.added.includes(ME)), show(f.writers("a.txt")));
  });

  test("a patch that does not fit the file on disk is not undone", (check) => {
    const f = fixture("misfit");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "misfit");
    const rec = readRecords(f.gitDir).get("a.txt")[0];
    check("the record holds no `pre`", rec.pre === null && rec.how === "none", show(rec));
  });

  test("one replacement is undone where the new text occurs once, and not where it occurs twice", (check) => {
    const f = fixture("replace");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "replace", { old_string: "line 3", new_string: "line 3 MINE" });
    check("occurring once, the line is this session's", all(f.writers("a.txt")[0].added, ME), show(f.writers("a.txt")));
    const g = fixture("replace-twice");
    g.unseen("a.txt", g.change("a.txt", { 9: "the same words" }));
    g.write(ME, "a.txt", g.change("a.txt", { 3: "the same words" }), "replace", { old_string: "line 3", new_string: "the same words" });
    check("occurring twice, the record holds no `pre`", readRecords(g.gitDir).get("a.txt")[0].pre === null);
    check("and nothing is this session's", g.writers("a.txt").every((h) => !h.added.includes(ME)), show(g.writers("a.txt")));
  });

  test("a removal is its remover's, by where it happened", (check) => {
    const f = fixture("removal");
    f.write(ME, "a.txt", f.change("a.txt", { 4: null }));
    f.write(PEER, "a.txt", f.change("a.txt", { 7: null }));
    f.unseen("a.txt", f.change("a.txt", { 9: null }));
    const w = f.writers("a.txt");
    check("three removals", w.length === 3 && w.every((h) => h.added.length === 0), show(w));
    check("this session's", all(w[0].removed, ME), show(w[0]));
    check("the peer's", all(w[1].removed, PEER), show(w[1]));
    check("nobody's", all(w[2].removed, NOBODY), show(w[2]));
  });

  test("a line a session wrote and removed again does not claim a peer's removal of the same text", (check) => {
    const f = fixture("churn");
    fs.writeFileSync(f.abs("a.txt"), `${["same", "same", ...BODY].join("\n")}\n`);
    f.git("commit", "-q", "-am", "two equal lines");
    // This session adds an equal line between the two and takes it out again.
    f.write(ME, "a.txt", `${["same", "same", "same", ...BODY].join("\n")}\n`);
    f.write(ME, "a.txt", `${["same", "same", ...BODY].join("\n")}\n`);
    // A writer no hook saw removes one of HEAD's two.
    f.unseen("a.txt", `${["same", ...BODY].join("\n")}\n`);
    const w = f.writers("a.txt");
    check("one removal", w.length === 1 && w[0].removed.length === 1, show(w));
    check("it is nobody's", w[0].removed[0] === NOBODY, show(w));
  });

  test("two equal lines two sessions removed are nobody's to take, and both sessions are named", (check) => {
    const f = fixture("removed-twice");
    f.unseen("a.txt", "top\nsame\nsame\nbottom\n");
    f.git("commit", "-q", "-am", "two equal lines");
    f.write(PEER, "a.txt", "top\nsame\nbottom\n");
    f.write(ME, "a.txt", "top\nbottom\n");
    const w = f.writers("a.txt");
    check("one hunk removes both, and neither removal is given to a session", w.length === 1 && show(w[0].removed) === show([NOBODY, NOBODY]), show(w));
    check("both sessions are among its writers", show([...w[0].among].sort()) === show([ME, PEER].sort()), show(w));
  });

  test("two sessions' entries appended one after the other are told apart inside one hunk", (check) => {
    const f = fixture("joined");
    f.write(ME, "a.txt", `${f.read("a.txt")}## mine\nmy entry\n`);
    f.write(PEER, "a.txt", `${f.read("a.txt")}## theirs\ntheir entry\n`);
    const h = f.hunks("a.txt");
    check("git reads one hunk", h.length === 1 && h[0].plus.length === 4, show(h));
    check("its lines are two sessions'", show(f.writers("a.txt")[0].added) === show([ME, ME, PEER, PEER]), show(f.writers("a.txt")));
  });

  test("a hunk whose lines repeat their neighbours is its writer's at every place git may put it", (check) => {
    const f = fixture("slide");
    f.unseen("a.txt", "first\n\nsecond\n\n\nthird\n");
    f.git("commit", "-q", "-am", "paragraphs");
    // A paragraph and a blank line: the blank before it and it, or it and the blank after.
    f.write(ME, "a.txt", "first\n\nnew\n\nsecond\n\n\nthird\n");
    for (const hunk of [{ newStart: 2, plus: ["", "new"], minus: [] }, { newStart: 3, plus: ["new", ""], minus: [] }]) {
      const w = writersOf(f.blamed("a.txt"), hunk);
      check(`added, placed at line ${hunk.newStart}`, w !== null && all(w.added, ME), show(w));
    }
    // One of two blank lines: the first of them or the second.
    f.write(ME, "a.txt", "first\n\nnew\n\nsecond\n\nthird\n");
    for (const hunk of [{ newStart: 5, plus: [], minus: [""] }, { newStart: 6, plus: [], minus: [""] }]) {
      const w = writersOf(f.blamed("a.txt"), hunk);
      check(`removed, placed after line ${hunk.newStart}`, w !== null && all(w.removed, ME), show(w));
    }
  });

  test("a file one session alone has written says so, and a file with another writer does not", (check) => {
    const f = fixture("sole");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE", 7: null }));
    check("this session is its only writer", soleWriter(f.blamed("a.txt"), new Set([ME])));
    check("another session is not", !soleWriter(f.blamed("a.txt"), new Set([PEER])));
    check("the content the ledger began from is kept", f.blamed("a.txt").origin === `${BODY.join("\n")}\n`);
    f.write(PEER, "a.txt", f.change("a.txt", { 9: null }));
    check("a peer's removal ends it", !soleWriter(f.blamed("a.txt"), new Set([ME])));
    const g = fixture("sole-unseen");
    g.write(ME, "a.txt", g.change("a.txt", { 3: "line 3 MINE" }));
    g.unseen("a.txt", g.change("a.txt", { 9: "line 9 UNSEEN" }));
    check("so does a line no hook saw", !soleWriter(g.blamed("a.txt"), new Set([ME])));
  });

  test("a line that could be either of two writers' is nobody's", (check) => {
    const f = fixture("slide-two");
    f.unseen("a.txt", "first\n\nsecond\n");
    f.git("commit", "-q", "-am", "paragraphs");
    f.write(ME, "a.txt", "first\n\n\nsecond\n");
    f.git("commit", "-q", "-am", "this session's blank line lands");
    // A script adds a third blank line beside the one this session wrote.
    f.unseen("a.txt", "first\n\n\n\nsecond\n");
    for (const newStart of [2, 3, 4]) {
      const w = writersOf(f.blamed("a.txt"), { newStart, plus: [""], minus: [] });
      check(`placed at line ${newStart}`, w !== null && all(w.added, NOBODY) && w.among.includes(ME), show(w));
    }
  });

  test("a new file is its creator's, and a line a script adds to it is not", (check) => {
    const f = fixture("create");
    f.write(ME, "docs/new.md", "one\ntwo\n");
    check("every line is this session's", all(f.blamed("docs/new.md").owners, ME), show(f.blamed("docs/new.md")));
    f.unseen("docs/new.md", "one\ntwo\nthree, by a script\n");
    check("the added line is nobody's", show(f.blamed("docs/new.md").owners) === show([ME, ME, NOBODY]), show(f.blamed("docs/new.md")));
  });

  test("a file no record names has no blame", (check) => {
    const f = fixture("none");
    f.unseen("a.txt", f.change("a.txt", { 3: "line 3" + " changed" }));
    check("blame is null", f.blamed("a.txt") === null);
  });

  test("CRLF content is read as the lines git reads", (check) => {
    const crlf = (text) => text.replace(/\r?\n/g, "\r\n");
    for (const shape of ["original", "patch"]) {
      const f = fixture(`crlf-${shape}`);
      f.unseen("a.txt", crlf(f.read("a.txt")));
      f.write(ME, "a.txt", crlf(f.change("a.txt", { 3: "line 3 MINE" })), shape);
      const w = f.writers("a.txt");
      check(`${shape}: one hunk, this session's`, w.length === 1 && all(w[0].added, ME) && all(w[0].removed, ME), show(w));
      check(`${shape}: the record holds a \`pre\``, readRecords(f.gitDir).get("a.txt")[0].how === shape, show(readRecords(f.gitDir).get("a.txt")));
    }
  });

  test("a change too large to align is nobody's", (check) => {
    const f = fixture("large");
    const big = (tag) => `${Array.from({ length: 2100 }, (_, n) => `${tag} ${n}`).join("\n")}\n`;
    f.unseen("a.txt", `top\n${big("old")}bottom\n`);
    f.git("commit", "-q", "-am", "a large file");
    f.write(ME, "a.txt", `top\n${big("new")}bottom\n`);
    const b = f.blamed("a.txt");
    check("no line of the rewrite is this session's", !b.owners.includes(ME), `${b.owners.filter((o) => o === ME).length} line(s)`);
  });

  test("the hook records nothing it cannot place, and never blocks", (check) => {
    const f = fixture("quiet");
    const outside = path.join(tmp, "outside.txt");
    fs.writeFileSync(outside, "x\n");
    const base = { session_id: ME, tool_name: "Write", tool_response: {} };
    const runs = [
      f.hook("not json"),
      f.hook({ ...base, tool_input: { file_path: outside } }),
      f.hook({ ...base, tool_input: { file_path: "a.txt" } }),
      f.hook({ ...base, tool_input: { file_path: f.abs(".git/config") } }),
      f.hook({ ...base, session_id: "../escape", tool_input: { file_path: f.abs("a.txt") } }),
      f.hook({ tool_name: "Bash", tool_input: { command: "echo" } }),
    ];
    check("every run exits 0 and prints nothing", runs.every((r) => r.status === 0 && !r.out), show(runs));
    check("no ledger was made", !fs.existsSync(path.join(f.gitDir, "acks-ledger")), fs.existsSync(path.join(f.gitDir, "acks-ledger")) ? fs.readdirSync(path.join(f.gitDir, "acks-ledger")).join(", ") : "");
  });

  test("the hook keeps no copy of a file in a repository without the commit tool, or of one git ignores", (check) => {
    const bare = fixture("no-tool", { tool: false });
    bare.write(ME, "a.txt", bare.change("a.txt", { 3: "line 3 MINE" }));
    check("no ledger in a repository without the tool", !fs.existsSync(path.join(bare.gitDir, "acks-ledger")));
    const f = fixture("ignored");
    f.write(ME, "local/secret.txt", "kept out of the repository\n");
    check("no ledger for an ignored file", !fs.existsSync(path.join(f.gitDir, "acks-ledger")));
    f.write(ME, "kept.txt", "an untracked file git does not ignore\n");
    check("an untracked file that is not ignored is recorded", readRecords(f.gitDir).has("kept.txt") && !readRecords(f.gitDir).has("local/secret.txt"), show([...readRecords(f.gitDir).keys()]));
  });

  test("a subagent's edit is recorded under its session, with the agent named", (check) => {
    const f = fixture("agent");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "original", { payload: { agent_id: "agent-7" } });
    const rec = readRecords(f.gitDir).get("a.txt")[0];
    check("session and agent", rec.session === ME && rec.agent === "agent-7", show(rec));
  });

  test("prune drops a session silent for longer than the ledger keeps, and only then", (check) => {
    const f = fixture("prune");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 9: "line 9 PEER" }));
    const day = 86_400_000;
    check("nothing is dropped a week on", show(prune(f.gitDir, Date.now() + 7 * day)) === show({ sessions: 0, blobs: 0 }));
    const dir = path.join(f.gitDir, "acks-ledger");
    // The peer writes again fifteen days on; this session has been silent since.
    fs.appendFileSync(path.join(dir, `${PEER}.jsonl`), `${JSON.stringify({ v: 1, ts: Date.now() + 15 * day, file: "b.txt", pre: null, post: null, how: "none" })}\n`);
    const gone = prune(f.gitDir, Date.now() + 15 * day);
    check("this session's file is gone and the peer's stays", gone.sessions === 1 && !fs.existsSync(path.join(dir, `${ME}.jsonl`)) && fs.existsSync(path.join(dir, `${PEER}.jsonl`)), show(gone));
    check("the blobs only this session named are gone", gone.blobs >= 1, show(gone));
  });

  // --- the guard ---

  const guarded = fixture("guarded", { origin: "https://example.invalid/owner/repo.git", tool: true });
  fs.mkdirSync(guarded.abs("sub"));
  const scratch = fixture("scratch-clone", { origin: guarded.repo, tool: true });
  const plain = fixture("plain", { origin: "https://example.invalid/owner/other.git", tool: false });
  /** Whether the guard denies a command line run from `cwd`, and what it said. */
  const guard = (command, { cwd = guarded.repo, tool_name = "Bash", project = guarded.repo, raw = null } = {}) => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: tmp, env: { ...process.env, CLAUDE_PROJECT_DIR: project }, input: raw ?? JSON.stringify({ tool_name, cwd, tool_input: { command } }), encoding: "utf8" });
    let decision = null;
    try {
      decision = JSON.parse(r.stdout).hookSpecificOutput;
    } catch {
      // No decision is a pass.
    }
    return { status: r.status, denied: decision?.permissionDecision === "deny", reason: decision?.permissionDecisionReason ?? "", out: r.stdout };
  };
  const posix = (p) => (process.platform === "win32" ? `/${p[0].toLowerCase()}${p.slice(2).replace(/\\/g, "/")}` : p);

  test("the guard denies the commands that write the shared index or commit it", (check) => {
    for (const command of ["git add -A", "git add a.txt", "git stage a.txt", "git commit -m x", "git commit --no-verify -m x", "git commit --amend --no-edit", "git rm a.txt", "git mv a.txt b.txt", "git -c core.autocrlf=false commit -m x", "FOO=1 git add ."]) {
      const r = guard(command);
      check(command, r.status === 0 && r.denied && /commit-own-hunks\.mjs/.test(r.reason), r.out);
    }
  });

  test("the guard denies the commands that unstage or discard without knowing whose", (check) => {
    for (const command of ["git reset --hard", "git reset --hard HEAD", "git reset HEAD~1", "git reset --soft HEAD~1", "git reset a.txt", "git restore a.txt", "git restore --source=HEAD~1 a.txt", "git restore --staged --worktree a.txt", "git restore -SW a.txt", "git stash", "git stash push -m x", "git stash pop", "git clean -fd", "git checkout -- a.txt", "git checkout .", "git checkout HEAD -- a.txt"]) {
      const r = guard(command);
      check(command, r.status === 0 && r.denied, r.out);
    }
  });

  test("the guard denies the commands that make or move commits by hand", (check) => {
    for (const command of ["git revert HEAD", "git cherry-pick abc123", "git am fix.patch", "git merge origin/main", "git pull", "git pull --ff-only origin main", "git rebase origin/main"]) {
      const r = guard(command);
      check(command, r.status === 0 && r.denied, r.out);
    }
  });

  test("the guard passes an unstage, which writes no file and moves no branch", (check) => {
    for (const command of ["git reset", "git reset -q", "git reset HEAD", "git reset -q HEAD -- a.txt b.txt", "git reset HEAD a.txt", "git reset -- a.txt", "git restore --staged a.txt", "git restore -S a.txt", "git restore --staged -- a.txt b.txt"]) {
      const r = guard(command);
      check(command, r.status === 0 && !r.denied, r.out);
    }
  });

  test("the guard finds the command behind a separator, a cd and a -C", (check) => {
    const elsewhere = { cwd: plain.repo, project: plain.repo };
    check("after &&", guard("git status && git commit -m x").denied);
    check("after ;", guard("echo x; git commit -m x").denied);
    check("on a later line", guard("echo x\ngit add -A").denied);
    check("in a subshell", guard("(cd sub && git commit -m x)").denied);
    check("cd into the guarded repository from elsewhere", guard(`cd "${posix(guarded.repo)}" && git commit -m x`, elsewhere).denied);
    check("-C into the guarded repository from elsewhere", guard(`git -C "${posix(guarded.repo)}" commit -m x`, elsewhere).denied);
    check("a PowerShell path with backslashes", process.platform !== "win32" || guard(`git -C ${guarded.repo} commit -m x`, { ...elsewhere, tool_name: "PowerShell" }).denied);
    const computed = guard('cd "$(pwd)" && git commit -m x', { cwd: plain.repo });
    check("a directory it cannot read falls back to the session's project", computed.denied);
    check("and the refusal says where it judged", computed.reason.includes(`it was judged in ${guarded.repo}`), computed.reason);
    check("a refusal in a directory it could read says no such thing", !/it was judged in/.test(guard("git commit -m x").reason));
    check("git under a path and an .exe is git", guard("/usr/bin/git add -A").denied && guard("git.exe commit -m x").denied && guard('"C:/Program Files/Git/cmd/git.exe" add -A').denied);
    check("and passes where that project is not guarded", !guard('cd "$(pwd)" && git commit -m x', elsewhere).denied);
  });

  test("the guard passes what reads, what pushes, and what only spells a command", (check) => {
    for (const command of [
      "git status --short",
      "git diff --cached --name-only",
      "git log --oneline -3",
      "git push origin abc123:refs/heads/main",
      "git stash list",
      "git fetch -q --tags origin",
      "git merge-base --is-ancestor HEAD origin/main",
      "git clean -n",
      "git checkout main",
      'echo "git commit -m x"',
      'grep -n "git add" notes.md',
      "git log --grep 'git commit; git add -A'",
      "cat > note.txt <<'EOF'\ngit commit -m x\ngit add -A\nEOF",
      `node ${TOOL} ship --change ../change`,
      "GIT_INDEX_FILE=/tmp/own-index git add a.txt",
      "export GIT_INDEX_FILE=/tmp/own-index; git add a.txt",
    ]) {
      const r = guard(command);
      check(command, r.status === 0 && !r.denied, r.out);
    }
    check("a private index does not excuse a commit", guard("GIT_INDEX_FILE=/tmp/own-index git commit -m x").denied);
  });

  test("the guard passes a repository it does not guard", (check) => {
    check("a scratch clone, whose origin is a path", !guard("git commit -m x", { cwd: scratch.repo }).denied);
    check("a scratch clone reached by cd from the guarded tree", !guard(`cd "${posix(scratch.repo)}" && git add -A && git commit -m x`).denied);
    check("a repository without the commit tool", !guard("git commit -m x", { cwd: plain.repo, project: plain.repo }).denied);
    check("a directory outside any repository", !guard("git commit -m x", { cwd: os.tmpdir(), project: os.tmpdir() }).denied);
    const r = guard("", { raw: "not json" });
    check("a payload that does not parse", r.status === 0 && !r.denied, r.out);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failures = results.filter((ok) => !ok).length;
console.log(`test-shared-tree-hooks: ${results.length} cases, ${failures} failed`);
if (failures) process.exit(1);
