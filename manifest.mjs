/**
 * Declares how each skeleton file participates in toolchain sharing.
 *
 * COPY            — canonical bytes, synced verbatim into every module repo.
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
  ".gitattributes",
  ".gitignore",
  ".github/workflows/release.yml",
  ".claude/settings.json",
  "tools/validate.mjs",
];

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
};

export const DEFAULT_TARGETS = [
  "acks-equipment",
  "acks-formation",
  "acks-henchmen",
  "acks-influence",
  "acks-monsters",
];
