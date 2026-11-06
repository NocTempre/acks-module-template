/**
 * Starts the canonical release preflight in throwaway repositories and checks
 * its exit status and what it names. Each case is a module tagged v1.0.0 with
 * its version bumped in the working tree, the way a release is prepared, and
 * differs in the kind it is given, the CHANGELOG it holds and the shots under
 * `docs/releases/`. Those decide the snapshot check: on a major or a minor,
 * every Added or Changed bullet of the bumped version's section names a shot
 * that was taken, or says why it has none, and a shot any other bullet names
 * was taken too.
 *
 * The preflight finds its repository from where it stands, so each case
 * copies it into the case's own `tools/` and starts it there.
 *
 * Usage:  node bin/test-release-preflight.mjs [<release-preflight.mjs>]
 *         (defaults to skeleton/tools/release-preflight.mjs; pass a modified
 *         copy to confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const PREFLIGHT = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "skeleton", "tools", "release-preflight.mjs"));

// A caller's own repository variables would turn every git call toward the
// caller's repository, and a runner has no identity to commit as.
for (const key of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/iu.test(key)) delete process.env[key];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (root, args) => execFileSync("git", args, { cwd: root, env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

// Every entry and slug below is invented.
const GREEN = `# Changelog

## Unreleased

### Added

- **An unreleased entry with no marker.** Not this release's to answer for.

## 1.1.0

### Added

- **A sheet gains a tab.** The tab lists what the sheet holds.
  <!-- shot: widget-sheet-tab -->
- **A dialog asks first.** It names what it will change.
  - A nested item, still this entry's.

  A second paragraph of the same entry.
  <!-- shot: widget-confirm --> <!-- shot: widget-confirm-cancel.png -->

### Changed

- **The api returns a promise.** <!-- no-shot: API only,
  nothing on screen -->

### Fixed

- **A crash on open.** No marker, and none owed.
- **A refusal says why.** A fixed entry with a visible surface.
  <!-- shot: widget-refusal -->

## 1.0.0

### Added

- **The first entry.** Unmarked, and an earlier release's.
`;
const ALL_SHOTS = ["widget-sheet-tab.png", "widget-confirm.png", "widget-confirm-cancel.png", "widget-refusal.png"];
const lineOf = (text, needle) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;
const UNMARKED = GREEN.replace(/ <!-- no-shot: API only,\n {2}nothing on screen -->/u, "");

const CASES = [
  {
    name: "a minor whose every Added and Changed bullet names a taken shot or a reason is clear",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    status: 0,
    out: [
      /release-preflight: v1\.1\.0 clear \(minor\)\./u,
      new RegExp(`taken {3}docs/releases/v1\\.1\\.0/widget-sheet-tab\\.png ← CHANGELOG\\.md:${lineOf(GREEN, "A sheet gains")} "A sheet gains a tab\\. The tab`, "u"),
      /taken {3}docs\/releases\/v1\.1\.0\/widget-confirm\.png ← CHANGELOG\.md:\d+ "A dialog asks first\./u,
      /taken {3}docs\/releases\/v1\.1\.0\/widget-confirm-cancel\.png ← CHANGELOG\.md:\d+ "A dialog asks first\./u,
      /CHANGELOG\.md:\d+ "The api returns a promise\.": API only, nothing on screen/u,
      /taken {3}docs\/releases\/v1\.1\.0\/widget-refusal\.png ← CHANGELOG\.md:\d+ "A refusal says why\./u,
    ],
    notOut: [/unreleased entry/u, /first entry/u, /crash on open/u],
  },
  {
    name: "a shot a Fixed entry names is held to the file check, though none is owed",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ALL_SHOTS.filter((s) => s !== "widget-refusal.png"),
    status: 1,
    err: [/"A refusal says why\. .*" names docs\/releases\/v1\.1\.0\/widget-refusal\.png, which does not exist/u],
    notErr: [/crash on open/u],
  },
  {
    name: "the same changelog with CRLF line ends reads alike",
    args: ["--kind", "minor"],
    changelog: GREEN.replaceAll("\n", "\r\n"),
    shots: ALL_SHOTS,
    status: 0,
    out: [/taken {3}docs\/releases\/v1\.1\.0\/widget-confirm-cancel\.png/u, /API only, nothing on screen/u],
  },
  {
    name: "a Changed bullet with no marker stops a minor, by line and label",
    args: ["--kind", "minor"],
    changelog: UNMARKED,
    shots: ALL_SHOTS,
    status: 1,
    err: [new RegExp(`FAIL CHANGELOG\\.md:${lineOf(UNMARKED, "The api returns")} "The api returns a promise\\." names no shot`, "u")],
    notErr: [/sheet gains/u, /crash on open/u, /unreleased entry/u, /first entry/u],
  },
  {
    name: "a major is held to the same entries",
    args: ["--kind", "major"],
    changelog: UNMARKED,
    shots: ALL_SHOTS,
    status: 1,
    err: [/"The api returns a promise\." names no shot/u],
  },
  {
    name: "a hotfix owes no shot",
    args: ["--kind", "hotfix"],
    changelog: UNMARKED,
    shots: [],
    status: 0,
    out: [/clear \(hotfix\)/u],
    notOut: [/shots the changelog names/u],
  },
  {
    name: "a shot a bullet names and nobody took stops a minor",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ["widget-sheet-tab.png", "widget-confirm-cancel.png"],
    status: 1,
    err: [/"A dialog asks first\. .*" names docs\/releases\/v1\.1\.0\/widget-confirm\.png, which does not exist/u],
    notErr: [/widget-sheet-tab/u, /widget-confirm-cancel/u],
  },
  {
    name: "--shots-pending lists a shot not yet taken instead of stopping",
    args: ["--kind", "minor", "--shots-pending"],
    changelog: GREEN,
    shots: ["widget-sheet-tab.png"],
    status: 0,
    out: [/to take docs\/releases\/v1\.1\.0\/widget-confirm\.png/u, /taken {3}docs\/releases\/v1\.1\.0\/widget-sheet-tab\.png/u],
  },
  {
    name: "a shot whose file differs only in letter case is not taken",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ["Widget-Sheet-Tab.png", "widget-confirm.png", "widget-confirm-cancel.png"],
    status: 1,
    err: [/names docs\/releases\/v1\.1\.0\/widget-sheet-tab\.png, which does not exist/u],
  },
  {
    name: "a no-shot marker with no reason stops",
    args: ["--kind", "minor"],
    changelog: GREEN.replace(/<!-- no-shot: API only,\n {2}nothing on screen -->/u, "<!-- no-shot: -->"),
    shots: ALL_SHOTS,
    status: 1,
    err: [/"The api returns a promise\." has a no-shot marker with no reason/u],
  },
  {
    name: "a shot marker naming a path or a list stops",
    args: ["--kind", "minor"],
    changelog: GREEN.replace("<!-- shot: widget-sheet-tab -->", "<!-- shot: ../v1.0.0/old.png --> <!-- shot: widget-a, widget-b -->"),
    shots: ALL_SHOTS,
    status: 1,
    err: [/shot marker naming "\.\.\/v1\.0\.0\/old\.png"/u, /shot marker naming "widget-a, widget-b"/u],
  },
  {
    name: "a minor whose section holds only Fixed entries is clear",
    args: ["--kind", "minor"],
    changelog: "# Changelog\n\n## 1.1.0\n\n### Fixed\n\n- **A crash on open.** No marker owed.\n",
    shots: [],
    status: 0,
    out: [/clear \(minor\)/u],
  },
  {
    name: "a minor with no section for its version stops",
    args: ["--kind", "minor"],
    changelog: GREEN.replace("## 1.1.0", "## 1.0.1"),
    shots: ALL_SHOTS,
    status: 1,
    err: [/CHANGELOG\.md has no section for 1\.1\.0/u],
  },
  {
    name: "a minor with no CHANGELOG at all stops",
    args: ["--kind", "minor"],
    shots: [],
    status: 1,
    err: [/there is no CHANGELOG\.md, so no section for 1\.1\.0/u],
  },
  {
    name: "a run with no kind stops",
    args: [],
    changelog: GREEN,
    shots: ALL_SHOTS,
    status: 1,
    err: [/no release kind — pass --kind major\|minor\|hotfix/u],
  },
  {
    name: "a kind that is not one of the three stops",
    args: ["--kind", "patch"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    status: 1,
    err: [/--kind patch is not a release kind/u],
  },
  {
    name: "a version already tagged is still refused beside the shot check",
    args: ["--kind", "minor"],
    version: "1.0.0",
    changelog: GREEN,
    shots: [],
    status: 1,
    err: [/tag v1\.0\.0 already exists locally/u],
  },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-preflight-"));
let failures = 0;
try {
  CASES.forEach((testCase, i) => {
    const problems = [];
    try {
      const root = path.join(tmp, `case-${i}`);
      fs.mkdirSync(path.join(root, "tools"), { recursive: true });
      fs.copyFileSync(PREFLIGHT, path.join(root, "tools", "release-preflight.mjs"));
      const manifest = (version) => fs.writeFileSync(path.join(root, "module.json"), `${JSON.stringify({ id: "widget", version }, null, 2)}\n`);
      manifest("1.0.0");
      git(root, ["init", "-q", "-b", "main"]);
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "--no-verify", "-m", "base"]);
      git(root, ["tag", "v1.0.0"]);
      const version = testCase.version ?? "1.1.0";
      manifest(version);
      if (testCase.changelog !== undefined) fs.writeFileSync(path.join(root, "CHANGELOG.md"), testCase.changelog);
      const shotDir = path.join(root, "docs", "releases", `v${version}`);
      fs.mkdirSync(shotDir, { recursive: true });
      for (const name of testCase.shots) fs.writeFileSync(path.join(shotDir, name), "not a real png\n");
      const r = spawnSync(process.execPath, [path.join("tools", "release-preflight.mjs"), ...testCase.args], { cwd: root, env: GIT_ENV, encoding: "utf8" });
      if (r.status !== testCase.status) problems.push(`exited ${r.status}, expected ${testCase.status}`);
      for (const [stream, text, expected, forbidden] of [
        ["stdout", r.stdout, testCase.out ?? [], testCase.notOut ?? []],
        ["stderr", r.stderr, testCase.err ?? [], testCase.notErr ?? []],
      ]) {
        for (const re of expected) if (!re.test(text)) problems.push(`${stream} does not match ${re}`);
        for (const re of forbidden) if (re.test(text)) problems.push(`${stream} matches ${re}`);
      }
      if (problems.length) problems.push(`stdout: ${r.stdout.trim() || "(empty)"}`, `stderr: ${r.stderr.trim() || "(empty)"}`);
    } catch (e) {
      // A case that throws is that case's failure, and the cases after it still run.
      problems.push(`threw: ${String(e.stack ?? e).split("\n").slice(0, 4).join("\n  ")}`);
    }
    if (problems.length) {
      failures++;
      console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}`);
    } else console.log(`ok   ${testCase.name}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const shown = path.relative(TEMPLATE_ROOT, PREFLIGHT);
console.log(`test-release-preflight: ${CASES.length} cases against ${shown.startsWith("..") ? PREFLIGHT : shown}, ${failures} failed`);
if (failures) process.exit(1);
