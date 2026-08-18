/**
 * Nightly family health run — deterministic, no model involved.
 *
 * For every DEFAULT_TARGETS repo: `npm run build:packs`, `npm run validate`,
 * `node tools/ip-scan.mjs`; plus one family-wide `sync-toolchain --check`.
 * Results land in `C:\Proj\acks-rules\nightly\<date>.md` (LOCAL-ONLY, same
 * posture as everything in acks-rules), and each failing repo gets ONE open
 * GitHub issue labeled `nightly-failure` (deduped against open issues, so a
 * broken week is one issue, not seven). `acks-bug-triage` pulls that label
 * as an intake surface.
 *
 * Scheduling is machine-specific — the Task Scheduler recipe lives in
 * TEST_ENVIRONMENT.md. Run manually anytime:
 *   node bin/nightly.mjs
 *
 * A dirty working tree is reported but not a failure — nightly runs against
 * whatever the tree holds, and an in-progress session is normal.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { DEFAULT_TARGETS } from "../manifest.mjs";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const PARENT = path.dirname(TEMPLATE_ROOT);
const REPORT_DIR = path.join(PARENT, "acks-rules", "nightly");

const date = new Date().toISOString().slice(0, 10);
const lines = [`# Nightly family run — ${date}`, ""];
const failures = [];

/** Runs a command in a repo, capturing combined output; returns {ok, out}. */
function run(cwd, cmd, args) {
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60 * 1000, shell: cmd === "npm" });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim() || String(err.message) };
  }
}

for (const target of DEFAULT_TARGETS) {
  const repoDir = path.join(PARENT, target);
  lines.push(`## ${target}`);
  if (!fs.existsSync(repoDir)) {
    lines.push("- SKIP: directory not found", "");
    continue;
  }
  const dirty = run(repoDir, "git", ["status", "--porcelain"]);
  if (dirty.out.trim()) lines.push(`- note: working tree dirty (${dirty.out.trim().split("\n").length} path(s))`);

  const repoFailures = [];
  for (const [label, cmd, args] of [
    ["build:packs", "npm", ["run", "build:packs"]],
    ["validate", "npm", ["run", "validate"]],
    ["ip-scan", process.execPath, [path.join(repoDir, "tools", "ip-scan.mjs")]],
  ]) {
    const res = run(repoDir, cmd, args);
    lines.push(`- ${label}: ${res.ok ? "OK" : "**FAIL**"}`);
    if (!res.ok) {
      repoFailures.push(label);
      lines.push("", "```", res.out.split("\n").slice(-25).join("\n"), "```", "");
    }
  }
  if (repoFailures.length) failures.push({ repo: target, what: repoFailures });
  lines.push("");
}

lines.push("## toolchain drift");
const drift = run(TEMPLATE_ROOT, process.execPath, [path.join(TEMPLATE_ROOT, "bin", "sync-toolchain.mjs"), "--check"]);
lines.push(`- sync-toolchain --check: ${drift.ok ? "clean" : "**DRIFT**"}`);
if (!drift.ok) {
  failures.push({ repo: "acks-module-template", what: ["toolchain drift"] });
  lines.push("", "```", drift.out.split("\n").slice(-25).join("\n"), "```");
}
lines.push("");

fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(REPORT_DIR, `${date}.md`);
fs.writeFileSync(reportPath, lines.join("\n"));
console.log(`report: ${reportPath}`);

/* One open nightly-failure issue per repo — a broken week is one issue. The
 * issue carries the failure names only, never report contents (the report
 * can quote validate output that embeds local paths; the ledger posture is
 * that acks-rules content stays off GitHub). */
for (const { repo, what } of failures) {
  const ghRepo = `NocTempre/${repo}`;
  const open = run(TEMPLATE_ROOT, "gh", ["issue", "list", "-R", ghRepo, "--label", "nightly-failure", "--state", "open", "--json", "number"]);
  if (open.ok && JSON.parse(open.out || "[]").length) {
    console.log(`${ghRepo}: nightly-failure issue already open — not filing another`);
    continue;
  }
  const create = run(TEMPLATE_ROOT, "gh", [
    "issue", "create", "-R", ghRepo,
    "--title", `Nightly run failed: ${what.join(", ")} (${date})`,
    "--body", `The nightly family run failed \`${what.join("`, `")}\` on ${date}. Details are in the local nightly report for that date. Label kept singular: close when green again.`,
    "--label", "nightly-failure",
  ]);
  console.log(create.ok ? `${ghRepo}: filed nightly-failure issue` : `${ghRepo}: could not file issue — ${create.out.split("\n")[0]}`);
}

process.exit(failures.length ? 1 : 0);
