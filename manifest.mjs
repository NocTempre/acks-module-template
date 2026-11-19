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
 * EXECUTABLE      — paths a module repo's commits hold as mode 100755, beside
 *                   whatever class gives them their bytes. The sync compares
 *                   the mode a repo's index holds and never writes it; the
 *                   scaffolder gives it to a new module's first commit.
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
  "tools/logs.mjs",
  "tools/walk-results.mjs",
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

/**
 * Git on a POSIX system runs a hook only where the file is executable, and
 * passes over one that is not with a hint and nothing else, so a hook
 * committed as 100644 gates no commit made there.
 */
export const EXECUTABLE = [".githooks/pre-commit"];

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
 * The repos a run with no `--repo` and no `--repo-path` syncs. Empty: this
 * template is retired (README.md) and no repo takes its canon, so such a run
 * reads nothing and writes nothing. `foundryvtt-acks-extras` holds the
 * toolchain as its own files, which a sync from here would overwrite.
 */
export const DEFAULT_TARGETS = [];
