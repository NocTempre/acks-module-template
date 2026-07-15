# ACKS Module Toolchain — Canonical Conventions

This document records the *decided answers* for the ACKS module family so no
future session re-derives them differently. When something here changes, change
it here first, then propagate with `bin/sync-toolchain.mjs`.

## 1. Repo anatomy

```
acks-<feature>/
  module.json              Foundry manifest — the real version number lives here
  scripts/                 ESM runtime code; entry point scripts/module.mjs
  templates/               Handlebars templates (may be nested)
  styles/                  CSS shipped to Foundry
  lang/en.json             Flat i18n keys, prefixed "<MODULE-ID-UPPERCASED>."
  packs/_source/<pack>/    JSON pack sources — committed
  packs/<pack>/            Compiled LevelDB packs — committed AND shipped
  ruledata/                (optional) runtime-fetched JSON rules — ships in zip
  tools/                   Dev harness — NOT shipped
    build-packs.mjs        SYNCED harness (needs tools/pack-data.mjs)
    pack-data.mjs          Module-owned document content; exports `packs` map
    validate.mjs           SYNCED validator
    test-logic.mjs         (optional) module-owned pure-logic tests
  docs/RULES.md            Canonical rules extract — replaces consulting PDFs
  docs/MODEL.md            Design doc (reuse → extend → enhance → invent)
  .github/workflows/release.yml   SYNCED release workflow
  .gitignore .gitattributes       SYNCED
  CLAUDE.md                RENDERED from skeleton per repo
  .claude/settings.json    SYNCED permission allowlist
  package.json             MERGED (scripts/devDeps/engines enforced)
  package-lock.json        Committed (CI uses `npm ci`)
```

## 2. Git conventions

- **Default branch: `main`.** (`acks-formation` is a legacy `master`; renaming
  requires a remote default-branch change on GitHub — do it deliberately.)
- **Tags: `v<semver>`** and the tag MUST equal `module.json` `version`
  (CI enforces this).
- **Compiled LevelDB packs are committed.** They ship in the zip and make
  git-clone dev installs work without a build step.
- **`.gitattributes` is mandatory.** `core.autocrlf=true` is common on Windows;
  without the `binary` markers git rewrites line endings in LevelDB files on
  checkout. `CURRENT` is plain text ("MANIFEST-00000N\n") that LevelDB parses
  strictly — a CRLF checkout breaks the pack on a fresh clone. Never remove
  those lines.
- **Never ignore `packs/**/*.log`** — LevelDB stores live data in `.log` files.
  The canonical `.gitignore` carries a comment to that effect.
- **Lockfiles are committed** for reproducible CI installs.
- After a local `npm run build:packs`, if `packs/_source` shows no diff, the
  LevelDB churn is timestamp noise: `git restore packs/ && git clean -fd packs/`.
  Commit rebuilt packs only when sources actually changed.

## 3. module.json conventions

- `id` == repo name == npm package name; `title` = `ACKS II — <Feature>`.
- `version`: plain semver `X.Y.Z`. Bump before tagging.
- `compatibility`: `minimum: "14"`, `verified: "14.364"` (raise `verified` as
  tested; existing modules keep their historical minimums until retested).
- `relationships.systems`: `acks`, `minimum: "14"`.
- Every `relationships.requires` entry carries a human `reason` and a
  `compatibility.minimum`. Standard deps when needed: `lib-wrapper` (>=1.12.0)
  for safe method wrapping, `socketlib` (>=1.1.0) for GM-routed writes.
- `manifest`/`download`: `https://github.com/NocTempre/<id>/releases/latest/download/module.json|zip`.
- **Declare a pack in `packs` only once it has content** (the build harness
  skips empty packs; CI fails on declared-but-missing packs).
- `languages`: at least `en` → `lang/en.json`.

## 4. Release pipeline (canonical `release.yml`)

Trigger: push tag `v*`. Steps: tag/version match check → `npm ci` →
`build:packs` → `validate` → `test` (each `--if-present`) → declared-pack
existence check → **ship-by-default zip** → publish `module.json` + `module.zip`
to the GitHub release.

The zip includes *everything* except an explicit dev-only denylist (`.git*`,
`.github`, `.claude`, `CLAUDE.md`, `node_modules`, `tools`, `packs/_source`,
`package*.json`). Rationale: the old allowlist zip silently dropped new
runtime dirs (henchmen's `ruledata/` had to be patched in by hand). New
runtime content now ships automatically; add to the denylist only for new
*dev-only* paths.

Release procedure (also encoded in the `acks-release` skill):

1. Bump `module.json` version (+ changelog if present).
2. `npm run build:packs` — commit pack changes only if `_source` changed.
3. `npm run validate` (and `npm test` where present).
4. Commit, `git tag v<version>`, push branch + tag.
5. `gh run watch` the Release workflow.
6. Verify: `curl -sL https://github.com/NocTempre/<id>/releases/latest/download/module.json`
   reports the new version.

## 5. Dev harness

- Node >= 20 (CI pins 20). devDependencies exactly:
  `@foundryvtt/foundryvtt-cli ^1.0.0`, `classic-level ^3.0.0`,
  `handlebars ^4.7.9`. (The core system uses foundryvtt-cli v3; upgrading the
  modules is a deliberate, together-only change.)
- `tools/pack-data.mjs` is the module-owned content file. Contract:
  `export const packs = { "<pack-name>": () => [docs] }` (arrays also accepted).
  Large data may live in sibling files (e.g. monsters' `bestiary-data.mjs`)
  re-exported through the map. Documents carry 16-char alphanumeric `_id` and a
  `_key` ending in that `_id`.
- `tools/validate.mjs` (synced) checks: JS syntax of `scripts/**` + `tools/**`,
  Handlebars compilation of `templates/**`, JSON validity of `module.json` /
  `package.json` / `lang/*.json` / `ruledata/**` / `packs/_source/**`,
  pack `_id`/`_key` invariants, `module.json` invariants (semver, paths exist,
  manifest URL shape), and that every i18n key referenced in code exists in
  `lang/en.json` (dynamic-suffix tolerant).
- Optional `tools/test-logic.mjs` (module-owned): pure-logic regression tests
  that mock minimal Foundry globals and import the real scripts (see
  acks-equipment). Wire as `"test"` in package.json; CI runs it `--if-present`.
- **Foundry dev install:** junction, not copy:
  `New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\<id>" -Target "C:\Proj\<id>"`

## 6. Design doctrine

**Reuse → extend → enhance → invent** (from acks-monsters, adopted family-wide):
reuse core system documents and fields; extend only with genuinely new data in
`flags["<module-id>"]`; enhance with alternate sheets/wrappers (libWrapper)
rather than replacements; invent nothing the system already provides.
`docs/MODEL.md` in each module records how that module applies this.

`docs/RULES.md` is the canonical extract of the relevant ACKS II rules —
sessions cite it instead of re-reading PDFs.

## 7. Claude infrastructure

- Each module carries a rendered `CLAUDE.md` (layout, commands, conventions,
  pointer here) and a synced `.claude/settings.json` allowlist covering the
  routine dev loop (npm, node harness, git incl. commit/tag/push, gh run,
  GitHub API reads). `settings.local.json` stays gitignored for personal
  grants.
- Shared skills live here in `.claude/skills/` and are installed to
  `~/.claude/skills/` by `sync-toolchain.mjs --install-skills`, so they work
  from any working directory (sessions usually run from `foundryvtt-acks-core`
  with the modules as additional dirs — note that in that setup only the *core*
  repo's settings govern permissions; the per-module settings.json pays off in
  standalone sessions).
- The core repo keeps its Claude context in an untracked `CLAUDE.md`
  (via `.git/info/exclude`) to avoid polluting the AutarchLLC fork.

## 8. Known deviations (as of 2026-07-15, post-rollout)

All five modules are on canon (sync `--check` reports zero drift). Remaining
deliberate deviations:

| Repo | Deviation | Path back to canon |
| --- | --- | --- |
| acks-formation | `master` branch; pack data inline in a custom 21 KB `build-packs.mjs` | rename branch on GitHub; extract data to `pack-data.mjs`, then sync harness |
| acks-influence | pack data inline in custom `build-packs.mjs`; `compatibility.minimum` still 13 | extract data; raise minimum when retested on 14 |

Pack-data `_stats` guidance learned during rollout: henchmen uses **fixed**
timestamps (rebuilds are byte-identical); equipment/formation/influence/
monsters stamp `Date.now()` at import, so every rebuild churns `packs/_source`.
Prefer fixed timestamps in new pack data; with `Date.now()` data, compare
diffs excluding `createdTime`/`modifiedTime` before deciding whether to commit
a rebuild.

## 9. Phase 2 (requires this repo on GitHub)

- Convert `release.yml` to a reusable `workflow_call` hosted here; module
  workflows shrink to ~10-line callers and can never drift.
- Publish the harness as a git-dependency npm package (`acks-tools`) with bin
  entries, replacing vendored `tools/*.mjs`.
