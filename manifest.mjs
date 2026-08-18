/**
 * Declares how each skeleton file participates in toolchain sharing.
 *
 * COPY            — canonical bytes, synced verbatim into every module repo.
 * APPEND_OK       — canonical bytes must appear as an exact PREFIX; a repo may
 *                   append its own lines below them but can never drop or
 *                   reorder canon. Only for ignore-style files, where the
 *                   append can only ever ADD protection (a repo-local ignore
 *                   cannot un-ignore a canonical entry). Keeps repo-specific
 *                   artifacts out of git without forcing them into canon.
 * COPY_IF_PACK_DATA — synced only into repos that have adopted the
 *                   tools/pack-data.mjs contract (repos with inline pack data
 *                   keep their custom builder until extracted).
 * RENDER          — re-rendered per repo from its module.json (placeholders).
 * package.json    — special-cased MERGE in sync-toolchain.mjs (enforces
 *                   scripts/engines/devDependencies, preserves the rest).
 * Everything else in skeleton/ is scaffold-only: it seeds new modules and is
 * never pushed into existing ones.
 */

export const COPY = [
  "LICENSE",
  ".gitattributes",
  ".github/workflows/release.yml",
  ".github/workflows/toolchain-check.yml",
  ".claude/settings.json",
  "tools/validate.mjs",
  "tools/ip-scan.mjs",
  "tools/ip-quarantine.mjs",
  "tools/release-preflight.mjs",
  ".githooks/pre-commit",
];

export const APPEND_OK = [".gitignore"];

/**
 * Directories synced recursively, verbatim, from the TEMPLATE REPO ROOT (not
 * skeleton/) into every module repo. The template's own copy is canonical —
 * it is also the live copy a session working in the template repo loads.
 * Every file under each dir is canon; a file in a target that canon does not
 * name is drift, and --apply deletes it (removals must propagate, or a
 * renamed skill lives on in every repo it ever reached). new-module.mjs
 * copies these trees into fresh scaffolds verbatim.
 */
export const COPY_DIRS = [".claude/skills", ".claude/rules", ".claude/hooks", ".claude/agents"];

export const COPY_IF_PACK_DATA = ["tools/build-packs.mjs"];

export const RENDER = ["CLAUDE.md"];

export const CANONICAL_DEV_DEPS = {
  "@foundryvtt/foundryvtt-cli": "^1.0.0",
  "classic-level": "^3.0.0",
  "handlebars": "^4.7.9",
};

export const CANONICAL_SCRIPTS = {
  "build:packs": "node tools/build-packs.mjs",
  "validate": "node tools/validate.mjs",
  // Arms the pre-commit IP quarantine on every clone. Hooks are not committed,
  // so without this a fresh clone would commit licensed material ungated.
  "prepare": "git config core.hooksPath .githooks",
};

/**
 * The LIVE module repos (working-dir names under C:\Proj). The nine pre-merge
 * feature repos this list used to name are retired read-only archives since
 * the 0.1.0 merge (acks-extras absorbed eight; acks-content became
 * acks-importer) — never sync into them.
 */
export const DEFAULT_TARGETS = [
  "foundryvtt-acks-extras",
  "foundryvtt-acks-importer",
];
