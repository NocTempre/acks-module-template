/**
 * Sync the canonical toolchain files into the existing ACKS module repos, and
 * install the shared Claude skills user-level.
 *
 * Usage:
 *   node bin/sync-toolchain.mjs [--check]            report drift (default; exit 1 if any)
 *   node bin/sync-toolchain.mjs --apply              write canonical files (skips dirty repos)
 *   node bin/sync-toolchain.mjs --apply --force      write even into dirty repos
 *   node bin/sync-toolchain.mjs --repo acks-monsters limit to named repo(s) (repeatable)
 *   node bin/sync-toolchain.mjs --install-skills     copy .claude/skills/* -> ~/.claude/skills/
 *
 * What syncs is declared in manifest.mjs. After --apply, run
 * `npm run build:packs && npm run validate` in each repo, discard LevelDB
 * timestamp churn (`git restore packs/ && git clean -fd packs/` when _source is
 * unchanged), and commit.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { COPY, COPY_IF_PACK_DATA, RENDER, CANONICAL_DEV_DEPS, CANONICAL_SCRIPTS, DEFAULT_TARGETS } from "../manifest.mjs";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const SKELETON = path.join(TEMPLATE_ROOT, "skeleton");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const INSTALL_SKILLS = args.includes("--install-skills");
const repoFilter = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--repo") repoFilter.push(args[i + 1]);

const norm = (text) => text.replaceAll("\r\n", "\n");
const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

let drift = 0;
const report = (repo, file, status) => {
  if (status !== "ok") drift++;
  console.log(`  ${status.padEnd(14)} ${file}`);
};

function renderVars(moduleJson) {
  return {
    MODULE_ID: moduleJson.id,
    MODULE_TITLE: (moduleJson.title ?? moduleJson.id).replace(/^ACKS II\s+—\s+/u, ""),
    MODULE_DESCRIPTION: moduleJson.description ?? "",
    LANG_PREFIX: (moduleJson.id ?? "").toUpperCase(),
  };
}
const render = (text, vars) =>
  Object.entries(vars).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

function syncFile(repoDir, relFile, canonicalText) {
  const dest = path.join(repoDir, relFile);
  const current = readIf(dest);
  if (current !== null && norm(current) === norm(canonicalText)) {
    report(repoDir, relFile, "ok");
    return;
  }
  if (!APPLY) {
    report(repoDir, relFile, current === null ? "missing" : "drift");
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, canonicalText);
  report(repoDir, relFile, current === null ? "created" : "updated");
}

function mergePackageJson(repoDir) {
  const file = path.join(repoDir, "package.json");
  const current = readIf(file);
  if (current === null) {
    report(repoDir, "package.json", "missing");
    return;
  }
  const pkg = JSON.parse(current);
  const changes = [];
  pkg.scripts ??= {};
  for (const [name, cmd] of Object.entries(CANONICAL_SCRIPTS)) {
    if (pkg.scripts[name] !== cmd) {
      pkg.scripts[name] = cmd;
      changes.push(`scripts.${name}`);
    }
  }
  pkg.devDependencies ??= {};
  for (const [dep, version] of Object.entries(CANONICAL_DEV_DEPS)) {
    if (pkg.devDependencies[dep] !== version) {
      pkg.devDependencies[dep] = version;
      changes.push(`devDependencies.${dep}`);
    }
  }
  if (!pkg.engines?.node) {
    pkg.engines = { ...pkg.engines, node: ">=20" };
    changes.push("engines.node");
  }
  if (!changes.length) {
    report(repoDir, "package.json", "ok");
    return;
  }
  if (!APPLY) {
    report(repoDir, `package.json (${changes.join(", ")})`, "drift");
    return;
  }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  report(repoDir, `package.json (${changes.join(", ")})`, "updated");
}

function syncRepo(repoDir) {
  const name = path.basename(repoDir);
  console.log(`\n=== ${name} ===`);
  if (!fs.existsSync(path.join(repoDir, "module.json"))) {
    console.log("  skipped: no module.json (not a module repo)");
    return;
  }
  const dirty = execFileSync("git", ["-C", repoDir, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty && APPLY && !FORCE) {
    console.log("  skipped: uncommitted changes (use --force to override)");
    drift++;
    return;
  }
  if (dirty) console.log("  note: repo has uncommitted changes");

  for (const relFile of COPY) {
    syncFile(repoDir, relFile, fs.readFileSync(path.join(SKELETON, relFile), "utf8"));
  }
  for (const relFile of COPY_IF_PACK_DATA) {
    if (fs.existsSync(path.join(repoDir, "tools", "pack-data.mjs"))) {
      syncFile(repoDir, relFile, fs.readFileSync(path.join(SKELETON, relFile), "utf8"));
    } else {
      console.log(`  custom         ${relFile} (no tools/pack-data.mjs — module keeps its own builder)`);
    }
  }
  const moduleJson = JSON.parse(fs.readFileSync(path.join(repoDir, "module.json"), "utf8"));
  const vars = renderVars(moduleJson);
  for (const relFile of RENDER) {
    syncFile(repoDir, relFile, render(fs.readFileSync(path.join(SKELETON, relFile), "utf8"), vars));
  }
  mergePackageJson(repoDir);
}

function installSkills() {
  const src = path.join(TEMPLATE_ROOT, ".claude", "skills");
  const dest = path.join(os.homedir(), ".claude", "skills");
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
    console.log(`installed skill ${entry.name} -> ${to}`);
  }
}

if (INSTALL_SKILLS) installSkills();

if (!INSTALL_SKILLS || APPLY || repoFilter.length) {
  const parent = path.dirname(TEMPLATE_ROOT);
  const targets = (repoFilter.length ? repoFilter : DEFAULT_TARGETS).map((t) => path.resolve(parent, t));
  for (const repoDir of targets) {
    if (!fs.existsSync(repoDir)) {
      console.log(`\n=== ${path.basename(repoDir)} ===\n  skipped: directory not found`);
      continue;
    }
    syncRepo(repoDir);
  }
  console.log(APPLY ? `\ndone: ${drift} file(s) written/skipped-dirty` : `\ndone: ${drift} file(s) drifted from canon`);
  if (!APPLY && drift) process.exit(1);
}
