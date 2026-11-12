/**
 * Release preflight gate. Run before tagging; `/acks-release` invokes it and
 * a red result stops the release.
 *
 * Checks, in order:
 *   1. The release kind is declared with --kind: major, minor or hotfix. The
 *      kind is never read off the version number, so a run without one is
 *      refused rather than guessed.
 *   2. The tag (v<module.json version>, or --tag) does not already exist,
 *      locally or on origin. A published tag is never reused — a version that
 *      needs fixing is released as the day's next version (check 6), not
 *      retagged.
 *   3. Every feature surface changed since the last v* tag has a live-test
 *      recipe: `scripts/<feature>/**` maps to `docs/<feature>/TESTING.md`,
 *      and files directly under `scripts/` map to `docs/TESTING.md`. The
 *      release report walks these recipes in the live session; a surface
 *      with no recipe has no defined pass condition, which is how a release
 *      ships hotfix bait. Changed means changed in the WORKING TREE relative
 *      to the last tag — committed or not, tracked or not: a release is
 *      normally prepared uncommitted, and a gate that reads only commits
 *      waives itself for exactly the run it exists to check.
 *   4. On a major or a minor, every top-level bullet under `### Added` or
 *      `### Changed` in the version's CHANGELOG.md section accounts for its
 *      release snapshot (TOOLCHAIN §4b). `<!-- shot: <feature-slug> -->` names
 *      `docs/releases/v<version>/<feature-slug>.png`, one marker per shot;
 *      `<!-- no-shot: <reason> -->` declares an entry with no user-visible
 *      surface. A marker may sit anywhere in the bullet, continuation lines
 *      included, and as an HTML comment it shows neither in the rendered
 *      changelog nor on the release page built from the section. An Added or
 *      Changed bullet with neither marker fails, as does a no-shot with no
 *      reason and a major or minor with no section for its version. A bullet
 *      under any other heading owes no marker, but a shot it names is held
 *      to the same file check, which is how a fix-driven minor's visible
 *      Fixed entry carries its shot. A named shot must exist with
 *      that exact letter case, which a Windows file check alone does not
 *      test. --shots-pending lists a missing one as still to take instead:
 *      on the run made before the live session that takes the shots, and on
 *      a machine with no test server, where no session takes them and the
 *      release report names each one. A hotfix owes no shot and skips the
 *      check.
 *   5. `version-date`, on every kind: module.json's version is a release day,
 *      `YYYY.M.D` with no leading zeros and an optional `.N` from 1 for a
 *      later release that day. The date must exist and must not be after
 *      today; a date before today warns and never fails. Today is the local
 *      date of the machine running the preflight, so CI, which runs on UTC,
 *      never judges the date.
 *   6. `version-order`, on every kind: the version is newer than every v* tag,
 *      local and on origin, whose version has the shape validate accepts,
 *      compared part by part as Foundry compares versions, and it is the
 *      day's next version: the bare date when no tag names that day, else the
 *      highest `.N` on that day plus one. A refusal prints the version it
 *      expects. Tags are never sorted as strings and `git describe` is not
 *      the last version: it names the nearest tag in history, not the highest.
 *   7. `changelog-compiled`, on every kind: no tracked file is left under
 *      `changelog.d/` (`node tools/logs.mjs compile` writes the section and
 *      deletes the fragments), no file there has a name that does not parse,
 *      and where runtime files (`scripts/`, `templates/`, `styles/`, `lang/`,
 *      `packs/_source/`) changed since the previous tag the version's CHANGELOG
 *      section holds a bullet. An untracked fragment is noted, not refused.
 *      The previous tag is the highest local v* tag by the check-6 compare,
 *      excluding this release's own; with none, the changed-files clause is
 *      silent.
 *   8. `logs-rolled`, on a major: for each CHANGELOG.md and
 *      `docs/**\/DECISIONS.md` present at the previous tag, its
 *      `<NAME>-through-v<prev>.md` archive exists beside it with the tag's
 *      blob hash (`node tools/logs.mjs roll` writes it); the live CHANGELOG
 *      holds no section for a version that has a tag and links the archive;
 *      the live DECISIONS links its archive, opens with `## In force`, has
 *      index links that resolve to a heading of the archive, shares no heading
 *      with it, and heads every entry `## YYYY-MM-DD — <title>`. Each
 *      `docs/**\/ROADMAP.md` present at the tag carries a `Re-issued
 *      <YYYY-MM-DD>.` stamp dated on or after the tag's commit, and every
 *      `docs/releases/v*` folder is linked from a guide or the GALLERY;
 *      --shots-pending lists an unlinked one instead of refusing it. A path
 *      that did not exist at the tag is not asked for.
 *
 * Exit 0 prints the recipes to walk and the shots the entries name; exit 1
 * lists every failure. A repo with no v* tag yet (first release) skips
 * check 3.
 *
 * Usage: node tools/release-preflight.mjs --kind major|minor|hotfix [--tag v<version>] [--shots-pending]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();

const args = process.argv.slice(2);
const tagArg = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : null;
const kind = args.includes("--kind") ? args[args.indexOf("--kind") + 1] : null;
const shotsPending = args.includes("--shots-pending");

const failures = [];
const fail = (msg) => failures.push(msg);

if (!["major", "minor", "hotfix"].includes(kind)) {
  fail(kind ? `--kind ${kind} is not a release kind — major, minor or hotfix` : "no release kind — pass --kind major|minor|hotfix; the kind is declared, never read off the version (TOOLCHAIN §4)");
}

const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8").replace(/^﻿/u, ""));
const tag = tagArg ?? `v${moduleJson.version}`;
if (tagArg && tagArg !== `v${moduleJson.version}`) {
  fail(`tag ${tagArg} does not match module.json version ${moduleJson.version}`);
}

/** The shape of a version Foundry can order; validate.mjs holds the same test. */
const ORDERABLE = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){2}(\.[1-9]\d*)?$/u;
/** A release day, `YYYY.M.D`, with an optional `.N` from 1 for a later release that day. */
const DATE_SHAPE = /^([1-9]\d{3})\.([1-9]|1[0-2])\.([1-9]|[12]\d|3[01])(?:\.([1-9]\d*))?$/u;

/**
 * Foundry's version compare, part by part: two numeric parts that differ
 * order numerically, parts that are equal as numbers but differ as strings
 * and non-numeric parts order as strings, and a longer version whose leading
 * parts are equal is the newer. Returns 1, -1 or 0.
 */
function compareVersions(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (/^\d+$/u.test(pa[i]) && /^\d+$/u.test(pb[i]) && Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]) ? 1 : -1;
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/** The release day a version names, as `{ y, m, d, n, day }`, or null where its shape is not a day or the day does not exist. */
function releaseDay(version) {
  const m = DATE_SHAPE.exec(version);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(y, mo - 1, d);
  if (real.getFullYear() !== y || real.getMonth() !== mo - 1 || real.getDate() !== d) return null;
  return { y, m: mo, d, n: m[4] ? Number(m[4]) : 0, day: `${y}.${mo}.${d}` };
}

const nowDate = new Date();
const today = { y: nowDate.getFullYear(), m: nowDate.getMonth() + 1, d: nowDate.getDate() };
today.day = `${today.y}.${today.m}.${today.d}`;

// Every v* tag, local and on origin. Both are read whole: the retag check and
// the version order need the same list, and one unreachable origin is noted once.
const tagNames = new Set(git("tag", "-l", "v*").split("\n").filter(Boolean));
const localTags = new Set(tagNames);
const remoteTags = new Set();
try {
  for (const line of execFileSync("git", ["-C", ROOT, "ls-remote", "--tags", "origin", "v*"], { encoding: "utf8" }).split("\n")) {
    const name = line.split("\t")[1]?.replace(/^refs\/tags\//u, "").replace(/\^\{\}$/u, "");
    if (name) {
      remoteTags.add(name);
      tagNames.add(name);
    }
  }
} catch {
  console.log("note: could not reach origin to check remote tags — verify manually");
}
const tagVersions = [...tagNames].map((t) => t.slice(1)).filter((v) => ORDERABLE.test(v));

/** The day's next version: the bare date where no tag names that day, else the day's highest `.N` plus one. */
function nextOfDay(day) {
  let highest = -1;
  for (const v of tagVersions) {
    if (v === day) highest = Math.max(highest, 0);
    else if (v.startsWith(`${day}.`) && /^\d+$/u.test(v.slice(day.length + 1))) highest = Math.max(highest, Number(v.slice(day.length + 1)));
  }
  return highest < 0 ? day : `${day}.${highest + 1}`;
}

const todaysNext = nextOfDay(today.day);
if (localTags.has(tag)) {
  fail(`tag ${tag} already exists locally — never retag; this release is ${todaysNext}`);
}
if (remoteTags.has(tag)) {
  fail(`tag ${tag} already exists on origin — never retag; this release is ${todaysNext}`);
}

let lastTag = "";
try {
  lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD");
} catch {
  console.log("note: no previous v* tag — first release, recipe check skipped");
}

const recipes = new Set();
if (lastTag) {
  // Two-argument diff (tag vs working tree), never `tag..HEAD`: HEAD misses
  // everything staged or unstaged. Untracked files are changes too — a
  // brand-new feature directory is invisible to diff until it is added.
  const changed = git("diff", "--name-only", lastTag).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", "scripts").split("\n").filter(Boolean);
  const slugs = new Set();
  let flatChanged = false;
  for (const file of [...changed, ...untracked]) {
    const m = file.match(/^scripts\/([^/]+)\/(.+)/u);
    if (m) slugs.add(m[1]);
    else if (/^scripts\/[^/]+$/u.test(file)) flatChanged = true;
  }
  for (const slug of [...slugs].sort()) {
    const recipe = path.join("docs", slug, "TESTING.md");
    if (fs.existsSync(path.join(ROOT, recipe))) recipes.add(recipe);
    else fail(`scripts/${slug}/ changed since ${lastTag} but ${recipe} does not exist — write the surface's live-test recipe first`);
  }
  if (flatChanged) {
    const recipe = path.join("docs", "TESTING.md");
    if (fs.existsSync(path.join(ROOT, recipe))) recipes.add(recipe);
    else fail(`scripts/ changed since ${lastTag} but ${recipe} does not exist — write the repo's live-test recipe first`);
  }
}

/**
 * The top-level bullets in a changelog's section for `version`, or null where
 * it has no such section. Each entry gives its 1-based line, a label cut from
 * its first line, whether it sits under `### Added` or `### Changed` (`owed`),
 * and every value its `shot:` and `no-shot:` markers carry. A bullet runs to
 * the next top-level bullet or heading, so nested items and continuation
 * lines are its own. The heading test is the release workflow's, so the
 * section read here is the one the release page is built from.
 */
function shotEntries(text, version) {
  const lines = text.replace(/^﻿/u, "").split(/\r?\n/u);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const heading = new RegExp(`^##\\s+(?:Release\\s+)?\\[?v?${esc}\\]?(?:\\s|$)`, "u");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  const entries = [];
  let owed = false;
  let entry = null;
  for (let i = start + 1; i < lines.length && !/^##\s/u.test(lines[i]); i++) {
    const line = lines[i];
    const sub = line.match(/^###\s+(.*?)\s*$/u);
    if (sub || /^#{1,6}\s/u.test(line)) {
      entry = null;
      if (sub) owed = /^(added|changed)$/iu.test(sub[1]);
      continue;
    }
    if (/^[-*+]\s/u.test(line)) {
      const label = line.replace(/<!--[\s\S]*?(-->|$)/gu, "").replace(/^[-*+]\s+/u, "").replaceAll("**", "").trim();
      entry = { line: i + 1, label: label.length > 72 ? `${label.slice(0, 71)}…` : label, owed, text: [] };
      entries.push(entry);
    }
    entry?.text.push(line);
  }
  for (const e of entries) {
    const body = e.text.join("\n");
    e.shots = [...body.matchAll(/<!--\s*shot:\s*([\s\S]*?)\s*-->/giu)].map((m) => m[1]);
    e.noShot = [...body.matchAll(/<!--\s*no-shot:\s*([\s\S]*?)\s*-->/giu)].map((m) => m[1].replace(/\s+/gu, " "));
    delete e.text;
  }
  return entries;
}

const shots = [];
const unshot = [];
if (kind === "major" || kind === "minor") {
  const version = moduleJson.version;
  const shotDir = `docs/releases/v${version}`;
  // Listed rather than probed, so a slug that differs from its file only in
  // letter case fails here as it fails on a case-sensitive checkout.
  const taken = fs.existsSync(path.join(ROOT, shotDir)) ? fs.readdirSync(path.join(ROOT, shotDir)) : [];
  const changelog = path.join(ROOT, "CHANGELOG.md");
  const hasLog = fs.existsSync(changelog);
  const entries = hasLog ? shotEntries(fs.readFileSync(changelog, "utf8"), version) : null;
  if (!entries) {
    fail(`${hasLog ? "CHANGELOG.md has" : "there is no CHANGELOG.md, so"} no section for ${version} — a ${kind} owes a shot per user-visible Added/Changed entry and the section is what maps them (TOOLCHAIN §4b)`);
  }
  for (const e of entries ?? []) {
    const where = `CHANGELOG.md:${e.line} "${e.label}"`;
    if (e.owed && !e.shots.length && !e.noShot.length) {
      fail(`${where} names no shot — add <!-- shot: <feature-slug> --> for ${shotDir}/<feature-slug>.png, or <!-- no-shot: <reason> --> where the entry has no user-visible surface (TOOLCHAIN §4b)`);
    }
    for (const reason of e.noShot) {
      if (reason) unshot.push({ where, reason });
      else fail(`${where} has a no-shot marker with no reason — say why the entry has no user-visible surface`);
    }
    for (const value of e.shots) {
      const slug = value.replace(/\.png$/iu, "");
      if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(slug)) {
        fail(`${where} has a shot marker naming "${value}" — one feature slug per marker, the file name under ${shotDir}/ without .png`);
        continue;
      }
      const file = `${shotDir}/${slug}.png`;
      const exists = taken.includes(`${slug}.png`);
      if (!exists && !shotsPending) fail(`${where} names ${file}, which does not exist — take the shot in the live session (TOOLCHAIN §4b); --shots-pending lists it instead, before that session or where this machine has no test server (§4a)`);
      shots.push({ file, where, exists });
    }
  }
}

const releaseVersion = String(moduleJson.version);
const releaseOn = releaseDay(releaseVersion);
if (!releaseOn) {
  fail(`version-date: ${releaseVersion} ${DATE_SHAPE.test(releaseVersion) ? "names a date that does not exist" : "is not a release day — YYYY.M.D, with no leading zeros and an optional .N from 1 for a later release that day"}`);
} else {
  const sign = Math.sign(releaseOn.y - today.y || releaseOn.m - today.m || releaseOn.d - today.d);
  if (sign > 0) fail(`version-date: ${releaseVersion} is after today (${today.day}) — a version names the day it is released`);
  else if (sign < 0) console.log(`warn version-date: ${releaseVersion} names ${releaseOn.day}, before today (${today.day})`);
}

if (ORDERABLE.test(releaseVersion)) {
  const notNewer = tagVersions.filter((t) => compareVersions(releaseVersion, t) <= 0).sort(compareVersions);
  const newest = [...tagVersions].sort(compareVersions).at(-1);
  const own = releaseOn ? nextOfDay(releaseOn.day) : null;
  if (notNewer.length) {
    // The day's next on the version's own day is expected only where it is itself newer than every tag.
    const expected = own && compareVersions(own, newest) > 0 ? own : todaysNext;
    fail(`version-order: ${releaseVersion} is not newer than tag v${notNewer.at(-1)} — this release is ${expected}`);
  } else if (own && releaseVersion !== own) {
    fail(`version-order: ${releaseVersion} is not the day's next version — this release is ${own}`);
  }
}

// The tag the logs are cut at: the highest local v* tag by Foundry's compare,
// never `git describe` (the nearest), and never the release's own tag.
const prevTag =
  [...localTags]
    .filter((t) => ORDERABLE.test(t.slice(1)) && t !== `v${releaseVersion}`)
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)))
    .at(-1) ?? "";
const notes = [];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** NUL-separated git listing, so a path is never quoted or split. */
const gitZ = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);

/** Every file under a directory, as posix paths relative to ROOT; empty where it is absent. */
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${rel}/${d.name}`) : [`${rel}/${d.name}`]));
}

/** GitHub's heading slug: lowercase, all but letters, numbers, spaces, hyphens and underscores dropped, spaces to hyphens. */
function slugOf(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[`*]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replaceAll(" ", "-");
}

/**
 * Every ATX heading outside a fenced block, as `{ level, text, anchor }`. A
 * repeated slug gains `-1`, `-2` in document order, across every level.
 */
function headingsOf(text) {
  const out = [];
  const seen = new Map();
  let fence = null;
  for (const raw of text.replace(/^﻿/u, "").split("\n")) {
    const l = raw.replace(/\r$/u, "");
    const f = /^ {0,3}(`{3,}|~{3,})/u.exec(l);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/u.exec(l);
    if (!m || !m[2]) continue;
    const slug = slugOf(m[2]);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    out.push({ level: m[1].length, text: m[2], anchor: n ? `${slug}-${n}` : slug });
  }
  return out;
}

// changelog-compiled, every kind.
{
  const FRAGMENT_NAME = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*\.(upgrading|added|changed|removed|fixed)\.md$/u;
  const tracked = new Set(gitZ("ls-files", "-z", "--", "changelog.d"));
  for (const f of walk("changelog.d")) {
    const name = f.slice("changelog.d/".length);
    if (!FRAGMENT_NAME.test(name)) fail(`changelog-compiled: ${f} is not named <YYYY-MM-DD>-<row id or slug>.<upgrading|added|changed|removed|fixed>.md`);
    else if (tracked.has(f)) fail(`changelog-compiled: ${f} is still on disk — run node tools/logs.mjs compile`);
    else notes.push(`${f} is untracked — not compiled; it rides with whoever tracks it`);
  }
  if (prevTag) {
    const touched = [...gitZ("diff", "-z", "--name-only", prevTag), ...gitZ("ls-files", "-z", "--others", "--exclude-standard")].filter((f) => /^(scripts|templates|styles|lang|packs\/_source)\//u.test(f));
    if (touched.length) {
      const hasLog = fs.existsSync(path.join(ROOT, "CHANGELOG.md"));
      const entries = hasLog ? shotEntries(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), releaseVersion) : null;
      if (!entries?.length) {
        const first = `${touched[0]}${touched.length > 1 ? ` and ${touched.length - 1} more` : ""}`;
        fail(`changelog-compiled: runtime files changed since ${prevTag} (${first}) but CHANGELOG.md ${entries ? `holds no bullet under ${releaseVersion}` : `has no section for ${releaseVersion}`} — write a changelog.d/ fragment and run node tools/logs.mjs compile`);
      }
    }
  }
}

// logs-rolled, major only.
if (kind === "major" && prevTag) {
  const atTag = gitZ("ls-tree", "-r", "-z", "--name-only", prevTag);
  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  const tagged = (v) => localTags.has(`v${v}`);
  const SHAPE = /^\d{4}-\d{2}-\d{2} — \S.*$/u;
  for (const source of atTag.filter((f) => f === "CHANGELOG.md" || /^docs\/(?:.+\/)?DECISIONS\.md$/u.test(f))) {
    const dir = path.posix.dirname(source);
    const base = path.posix.basename(source, ".md");
    const archiveName = `${base}-through-${prevTag}.md`;
    const archive = dir === "." ? archiveName : `${dir}/${archiveName}`;
    const archiveOk = exists(archive);
    if (!archiveOk) fail(`logs-rolled: ${archive} is missing — a major archives ${source} as ${prevTag} shipped it; run node tools/logs.mjs roll`);
    else if (git("hash-object", "--", archive) !== git("rev-parse", `${prevTag}:${source}`)) fail(`logs-rolled: ${archive} differs from ${source} at ${prevTag} — an archive is the tag's blob byte for byte; restore it with git show ${prevTag}:${source}`);
    if (!exists(source)) {
      fail(`logs-rolled: ${source} is missing, so nothing links ${archive}`);
      continue;
    }
    const live = read(source);
    const links = (name) => new RegExp(`\\]\\(\\s*<?(?:\\./)?${escapeRe(name)}(?:#[^)\\s]*)?>?\\s*\\)`, "u").test(live);
    if (!links(archiveName)) fail(`logs-rolled: ${source} does not link ${archiveName}`);
    const liveHeads = headingsOf(live);
    if (base === "CHANGELOG") {
      for (const h of liveHeads.filter((x) => x.level === 2)) {
        const v = /^(?:Release\s+)?\[?v?(\d[^\]\s]*)\]?(?:\s|$)/u.exec(h.text)?.[1];
        if (v && tagged(v)) fail(`logs-rolled: ${source} still holds "## ${h.text}", whose version has a tag — ${archiveName} holds it`);
      }
      continue;
    }
    const h2 = liveHeads.filter((h) => h.level === 2);
    if (!h2.some((h) => h.text === "In force")) fail(`logs-rolled: ${source} has no "## In force" section — a live DECISIONS opens with its index of the rulings that still govern`);
    else if (archiveOk) {
      const lines = live.split("\n");
      const at = lines.findIndex((l) => /^##[ \t]+In force[ \t]*\r?$/u.test(l));
      const next = lines.findIndex((l, i) => i > at && /^##[ \t]+/u.test(l));
      const index = lines.slice(at + 1, next < 0 ? lines.length : next).join("\n");
      const anchors = new Map();
      for (const m of index.matchAll(/\]\(\s*<?([^)#\s>]+)(?:#([^)\s>]*))?>?\s*\)/gu)) {
        if (/^[a-z][a-z0-9+.-]*:/iu.test(m[1])) continue;
        const target = path.posix.normalize(dir === "." ? m[1] : `${dir}/${m[1]}`);
        if (!exists(target)) {
          fail(`logs-rolled: ${source} index links ${m[1]}, which does not exist`);
          continue;
        }
        if (m[2] === undefined) continue;
        if (!anchors.has(target)) anchors.set(target, new Set(headingsOf(read(target)).map((h) => h.anchor)));
        if (!anchors.get(target).has(m[2])) fail(`logs-rolled: ${source} index links ${m[1]}#${m[2]}, and no heading of ${m[1]} has that anchor`);
      }
      const archived = new Set(headingsOf(read(archive)).filter((h) => h.level === 2).map((h) => h.text));
      for (const h of h2) if (h.text !== "In force" && archived.has(h.text)) fail(`logs-rolled: "## ${h.text}" is in both ${source} and ${archiveName} — a ruling lives in one`);
    }
    for (const h of h2) if (h.text !== "In force" && !SHAPE.test(h.text)) fail(`logs-rolled: ${source} heading "## ${h.text}" is not "## YYYY-MM-DD — <title>" — a live entry takes the one shape`);
  }
  const since = git("log", "-1", "--format=%cs", prevTag);
  for (const road of atTag.filter((f) => /^docs\/(?:.+\/)?ROADMAP\.md$/u.test(f) && exists(f))) {
    const stamps = [...read(road).matchAll(/Re-issued (\d{4}-\d{2}-\d{2})\./gu)].map((m) => m[1]);
    if (!stamps.some((d) => d >= since)) fail(`logs-rolled: ${road} has no "Re-issued <YYYY-MM-DD>." stamp dated ${since} or later — built rows go, the rest carry, under the stamp`);
  }
  const linked = [...walk("docs/guides").filter((f) => f.endsWith(".md")), ...(exists("docs/GALLERY.md") ? ["docs/GALLERY.md"] : [])].map(read).join("\n");
  const folders = exists("docs/releases") ? fs.readdirSync(path.join(ROOT, "docs/releases"), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("v")) : [];
  for (const d of folders) {
    if (linked.includes(`releases/${d.name}/`)) continue;
    if (shotsPending) notes.push(`docs/releases/${d.name}/ is linked by no guide or gallery row — delete it, or link it, before the release ships`);
    else fail(`logs-rolled: docs/releases/${d.name}/ is linked by no guide and no GALLERY row — delete it (the tag keeps it); --shots-pending lists it instead while shots are pending`);
  }
}

for (const n of notes) console.log(`note: ${n}`);

if (failures.length) {
  console.error(`release-preflight: ${failures.length} blocker(s) for ${tag}:`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`release-preflight: ${tag} clear (${kind}).`);
if (recipes.size) {
  console.log("recipes to walk in the live session:");
  for (const r of [...recipes].sort()) console.log(`  ${r}`);
} else if (lastTag) {
  console.log("no scripts/ surfaces changed since the last tag.");
}
if (shots.length) {
  console.log("shots the changelog names:");
  for (const s of shots) console.log(`  ${s.exists ? "taken  " : "to take"} ${s.file} ← ${s.where}`);
}
if (unshot.length) {
  console.log("entries with no shot:");
  for (const u of unshot) console.log(`  ${u.where}: ${u.reason}`);
}
