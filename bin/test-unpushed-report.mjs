/**
 * Drives the `unpushed-report.mjs` Stop hook against a throwaway clone and
 * checks what it exists to guarantee: a commit the upstream lacks is named by
 * sha, a listing is shown once and again only when it changes, a pushed
 * checkout says nothing, and no input makes the hook exit non-zero or ask for
 * anything but a message.
 *
 * Usage:  node bin/test-unpushed-report.mjs [--hook <unpushed-report.mjs>]
 *         (defaults to the copy in this repository; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const HOOK = path.resolve(process.argv.includes("--hook") ? process.argv[process.argv.indexOf("--hook") + 1] : path.join(TEMPLATE_ROOT, ".claude/hooks/unpushed-report.mjs"));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "unpushed-report-test-"));
const remote = path.join(scratch, "remote.git");
const work = path.join(scratch, "family", "module");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (name) => {
  fs.writeFileSync(path.join(work, name), name);
  git(work, "add", name);
  git(work, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", `adds ${name}`);
  return git(work, "rev-parse", "--short", "HEAD");
};

fs.mkdirSync(path.dirname(work), { recursive: true });
execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
execFileSync("git", ["clone", "-q", remote, work], { stdio: "ignore" });
git(work, "checkout", "-q", "-B", "main");
commit("first");
git(work, "push", "-q", "-u", "origin", "main");

const tag = `t${process.pid}-${Date.now()}`;
/** Runs the hook as Claude Code does and returns its exit status and parsed output. */
function stop(session, input) {
  const run = spawnSync(process.execPath, [HOOK], { input: input ?? JSON.stringify({ session_id: `${tag}-${session}`, cwd: work, hook_event_name: "Stop" }), encoding: "utf8" });
  let out = null;
  try {
    out = run.stdout ? JSON.parse(run.stdout) : null;
  } catch {
    out = { unparseable: run.stdout };
  }
  return { status: run.status, out };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const silent = (r) => r.status === 0 && r.out === null;

let r = stop("a");
check("a pushed checkout says nothing", silent(r), JSON.stringify(r));

const second = commit("second");
r = stop("a");
check("a local commit is named by sha", r.status === 0 && r.out?.systemMessage?.includes(second) && r.out.systemMessage.includes("module: 1 commit(s) not on origin/main"), JSON.stringify(r));
check("the output is a message and nothing else", r.out && Object.keys(r.out).join() === "systemMessage", JSON.stringify(r.out));

r = stop("a");
check("the same listing is not shown twice to one session", silent(r), JSON.stringify(r));

r = stop("b");
check("another session is shown it once", r.out?.systemMessage?.includes(second), JSON.stringify(r));

const third = commit("third");
r = stop("a");
check("a changed listing is shown again", r.out?.systemMessage?.includes(third) && r.out.systemMessage.includes(second), JSON.stringify(r));

git(work, "push", "-q", "origin", "main");
r = stop("a");
check("after the push it says nothing", silent(r), JSON.stringify(r));

const fourth = commit("fourth");
r = stop("a");
check("a commit after a push is reported", r.out?.systemMessage?.includes(fourth) && !r.out.systemMessage.includes(third), JSON.stringify(r));

for (let i = 0; i < 12; i++) commit(`bulk${i}`);
r = stop("a");
check("a long listing is cut to a count", /and 3 more/.test(r.out?.systemMessage ?? ""), JSON.stringify(r));

const template = path.join(scratch, "family", "acks-module-template");
execFileSync("git", ["clone", "-q", remote, template], { stdio: "ignore" });
fs.writeFileSync(path.join(template, "canon"), "canon");
git(template, "add", "canon");
git(template, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "adds canon");
const canon = git(template, "rev-parse", "--short", "HEAD");
r = stop("a");
check("the template beside the project is read too", r.out?.systemMessage?.includes(canon) && r.out.systemMessage.includes("acks-module-template: 1 commit(s)") && r.out.systemMessage.includes("module: 13 commit(s)"), JSON.stringify(r));

const bare = path.join(scratch, "not-a-repo");
fs.mkdirSync(bare);
r = stop("c", JSON.stringify({ session_id: `${tag}-c`, cwd: bare }));
check("a folder in no repository says nothing", silent(r), JSON.stringify(r));

r = stop("d", "not json");
check("an unparseable payload exits 0 in silence", silent(r), JSON.stringify(r));

fs.rmSync(scratch, { recursive: true, force: true });
for (const f of fs.readdirSync(path.join(os.tmpdir(), "acks-unpushed-report")).filter((f) => f.startsWith(tag))) fs.rmSync(path.join(os.tmpdir(), "acks-unpushed-report", f), { force: true });

const failures = results.filter((ok) => !ok).length;
console.log(`test-unpushed-report: ${results.length} cases, ${failures} failed`);
process.exit(failures ? 1 : 0);
