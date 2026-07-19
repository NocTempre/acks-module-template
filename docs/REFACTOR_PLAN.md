# ACKS Module Family — Refactor Plan

Staged migration to the proposed [FAMILY.md](FAMILY.md) architecture. Drafted
2026-07-15 after a full-family audit. **Status: proposal — execution has not
begun; no repo has been touched.** Each phase is independently releasable —
all six repos stay working at every step. Execute phases in separate sessions
on explicit go-ahead; update the status table as they land.

Until then, module development continues unchanged under TOOLCHAIN.md — do
not pre-implement phases or preemptively conform module code/docs to
FAMILY.md. In-flight module releases are expected and fine; each phase rebases
on whatever the repos look like when it actually runs.

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Hygiene (manifests, timestamps, ruling) | pending |
| 1 | Build acks-lib v1.0.0 + template enforcement | partial — repo exists, scoped v0.1 (2026-07-18); tables registry + services landed v0.7.0 via CONTENT-EXTRACTION.md (2026-07-19); §3c economy.json superseded (no book values ship) |
| 2 | Hierarchy adoption + data dedupe | pending |
| 3 | Plumbing adoption | pending |
| 4 | Data externalization (ruledata rollout) | pending |
| 5 | Pack pipeline convergence | pending |
| 6 | Docs polish + future groundwork | pending |

## Findings that motivated this (2026-07-15 audit)

**Duplicated data (one-to-one violations):**

1. Henchman Monthly Wage ladder `[12, 25, … 350000]` — in
   `acks-henchmen/ruledata/wages.json` AND
   `acks-influence/scripts/constants.mjs` (`HENCHMAN_MONTHLY_WAGE`, ~line 124,
   used for bribe fees).
2. Six social proficiency items shipped by BOTH
   `acks-influence/packs/_source/proficiencies/` and
   `acks-henchmen/packs/_source/proficiencies-powers/` (Beast Friendship,
   Bribery, Diplomacy, Mystic Aura, Seduction, Intimidation/"Intimidate") —
   same RAW proficiency, different `_id`s, **disjoint** automation: influence's
   carry `flags.acks-influence.reaction` effects, henchmen's carry
   `flags.acks-henchmen.hiring`/`recruitKinds`. Both packs enabled ⇒ duplicate
   items; importing either ⇒ silently loses the other module's behavior.
3. Monster saves LUT — core `src/module/config.mjs` `monster_saves` mirrored by
   `acks-monsters/scripts/config.mjs` `MONSTER_SAVES_LUT` (~line 362).
4. Signing-bonus formula divergence — henchmen `scripts/rules/wages.mjs`
   (week = monthly/30×7) vs sibling acks-domains `module/rules/downtime.mjs`
   (week = monthly/4).

**Hidden mutual dependency:** henchmen consumes influence (rollComplete hook,
`api.open`, reaction flags — `scripts/integrations/influence.mjs`,
`scripts/effects.mjs`) while influence duplicates henchmen's wage data; henchmen
probes `acks-monsters` API (`scripts/acks-adapter.mjs`,
`scripts/engine/monster.mjs`); formation reads monsters' `extras` flag schema
raw (`scripts/monster-traits.mjs`). None declared in manifests except one soft
`recommends` (formation → monsters, no minimum).

**Copy-pasted plumbing:** socketlib GM-relay ×3 (henchmen `sockets.mjs`,
formation `socket.mjs`, influence `module.mjs` inline), AE flag-collector ×2
(equipment `effects.mjs` mirrors henchmen's), sheet header-button idiom ×3
(influence, henchmen, acks-domains), ruledata table loader ×1 (only henchmen).

**Hardcoded data:** henchmen is the reference (`ruledata/*.json` + pure
registry `scripts/rules/tables.mjs`; Node reads the same JSON from disk). The
other four keep rules tables in `.mjs` — see Phase 4 table. monsters'
`BODY_FORMS`/`SPECIAL_ABILITIES` are schema-bound (DataModel `choices` at
`init`) and stay code by rule.

**Manifest/code drift:** equipment declares socketlib + `socket: true` with
zero socket code, and a `rollWeapon` wrap that doesn't exist (only `rollAttack`
is wrapped, `scripts/roll-wrap.mjs`).

**Confirmed sound:** no libWrapper collisions, no monkey-patching, per-module
socket channels, every module already exposes `game.modules.get(id).api` +
`globalThis.acks<Name>`.

---

## Phase 0 — Hygiene

Patch releases; no behavior change, no new family edges.

- **acks-equipment `module.json`:** `socket: false`; remove the socketlib
  `requires` entry; fix the lib-wrapper `reason` to name only
  `AcksActor#rollAttack`.
- **Pin fixed `_stats` timestamps** in the pack builders of acks-monsters
  (`tools/bestiary-data.mjs`), acks-formation and acks-influence (inline in
  their custom `build-packs.mjs`) — pin to the values already committed in
  `packs/_source` so a rebuild is a no-op (equipment's `STAMP` pattern;
  TOOLCHAIN §8 guidance).
- **Record the signing-bonus ruling** in `acks-henchmen/docs/RULES.md`:
  canonical form is day-consistent (day = monthly/30, week = 7×day). File a
  follow-up for acks-domains (outside this plan) to adopt it.
- Explicitly do **not** add module↔module `recommends` — an earlier draft idea,
  superseded by the FAMILY.md hierarchy.

**Verify:** `npm run validate` per touched repo; `npm run build:packs` →
`git diff packs/_source` empty (proves pinning); Foundry smoke: world with all
five loads clean, equipment works with socketlib disabled.

## Phase 1 — Build acks-lib v1.0.0 + template enforcement

The keystone; the largest phase. Contents are specified in FAMILY.md §3.

> **Scoped early start (2026-07-18):** `C:\Proj\acks-lib` now exists as a
> scaffolded **v0.1** carrying ONLY the shared effect/ability **vocabulary +
> LevelValue + DataModel field-builders** (`scripts/vocab.mjs`, `scripts/
> fields.mjs`; contract in its `docs/API.md`) — created to unblock the
> acks-abilities program. It is **additive to this plan, not a divergence**:
> the plumbing/interop/economy/social-proficiency-pack contents below remain
> unbuilt, `library:true`/`socket:false` are set, and no consumer edges or
> template enforcement have landed. When the full phase runs it fills the same
> repo. acks-monsters vocab migration stays deferred (documented mirror).

- Scaffold `C:\Proj\acks-lib` with `/acks-new-module` (short key `acksLib`).
- Port plumbing: `scripts/tables.mjs` (henchmen's file + priority),
  `scripts/ruledata.mjs`, `scripts/socket-relay.mjs` (union of henchmen +
  formation semantics), `scripts/effects.mjs` (generic collector core),
  `scripts/sheet-header.mjs`.
- Implement `acksLib.services` registry + `acksLib.data.monsterExtras` facade
  (raw-flag fallback) + canonical hook name constants.
- Author `ruledata/economy.json` (wage ladder + signing-bonus fractions, with
  `source` cites) and the `social-proficiencies` pack via `tools/pack-data.mjs`
  — six merged items: `acksLib` `_id`s, RAW names ("Intimidation"), henchmen's
  descriptions, `effects` = union of both modules' effect documents; regenerate
  embedded-effect `_key`s against the new parent `_id`s (validate.mjs §5
  invariants are the guard).
- Core-deferral shim (`game.acks?.lib ?? localImpl`), `globalThis.acksLib` at
  evaluation, `api` (with `apiVersion: 1`) at `init`; `docs/API.md` = the
  contract page (service shapes, hook payloads, priority levels, load-order
  rule).
- `module.json`: `library: true`, `socket: false`, requires system only,
  `recommends` all five modules with reasons.
- GitHub repo + release v1.0.0 via `/acks-release`.
- **Template changes:** TOOLCHAIN.md gains a cross-link to FAMILY.md /
  REFACTOR_PLAN.md, the hierarchy rules, and the ruledata design rule
  ("ruledata/ = runtime rules-lookup tables; DataModel-schema vocabulary,
  enums, flag keys, hook names, regexes, formulas stay in code") — TOOLCHAIN.md
  is deliberately untouched before this phase;
  new `bin/check-family.mjs` implementing the FAMILY.md §2 invariants
  (manifest-edge lint, `game.modules.get("acks-…")` grep lint, sanctioned-mirror
  value checks — run from the side-by-side C:\Proj layout like
  sync-toolchain); skeleton scaffolds `requires acks-lib`, api-exposure with
  `apiVersion`, a ruledata-load block, and a `docs/API.md` stub.

**Verify:** lib `npm run validate` + build:packs; template `ci.yml` green;
`node bin/check-family.mjs` runs (expected: reports the five modules' pending
violations as TODO until Phase 2, or gate it to lib-only until then); Foundry:
enable acks-lib alone → no errors, pack visible, `globalThis.acksLib` present.

## Phase 2 — Hierarchy adoption + data dedupe

The user-visible payoff. Requires lib v1.0.0 released. Order within the phase
is flexible except: influence/henchmen pack deletions ship only after the lib
pack exists (it does, from Phase 1).

- **acks-influence** (minor bump): add `requires acks-lib` (+ minimum); delete
  its six pack items and `HENCHMAN_MONTHLY_WAGE`; bribe fee
  (`scripts/actor-data.mjs` `monthlyWageForHD`) reads the lib economy table;
  register the `reaction` service at init; fire the lib-canonical hook
  (dual-fire the legacy `acksInfluence…` names for one release);
  `docs/API.md` documenting its AE convention + service payloads.
- **acks-henchmen** (minor bump): add `requires acks-lib`; delete its six pack
  items from `tools/pack-data.mjs`; `scripts/rules/wages.mjs` reads the ladder
  from the lib economy table (`ruledata/wages.json` drops the ladder, keeps
  hireling tables); consume reaction + monster-extras via lib service/facade —
  drop the direct `game.modules.get` probes in `scripts/acks-adapter.mjs`,
  `scripts/engine/monster.mjs`, `scripts/integrations/influence.mjs`. Release
  notes carry migration guidance: world-imported items keep working via
  name-fallbacks; re-import from the lib pack for merged automation.
- **acks-monsters** (minor bump): add `requires acks-lib`; register
  `monster-extras` at init; `api.apiVersion = 1`; `ready`-hook drift warning
  comparing `MONSTER_SAVES_LUT` to `CONFIG.ACKS.monster_saves` (key remap
  d/w/p/b/s → core names, single `console.warn` on mismatch); `docs/API.md`
  documenting the `extras` flag schema (`hd.count`, `vision`,
  `otherSenses[].type`, `speeds[].{type,run}`) and the promise that schema
  changes bump `apiVersion`.
- **acks-formation** (minor bump): add `requires acks-lib`;
  `scripts/monster-traits.mjs` switches to `acksLib.data.monsterExtras()`;
  **remove** the `acks-monsters` `recommends`.
- Enable full enforcement in `bin/check-family.mjs` (violations now fail).

**Verify:** validate + build per repo; `check-family.mjs` green; Foundry smoke —
(i) all-six world: exactly one copy of each social proficiency (lib pack);
imported merged Beast Friendship shows hiring +2 AND reaction +2;
(ii) henchmen+lib world (no influence): lib-pack items still feed hiring via
the `flags.acks-influence.reaction` bridge, name-fallbacks cover legacy items;
(iii) influence+lib world: bribe fee auto-fills from the lib economy table
(temporarily edit `economy.json` to prove the live path);
(iv) formation+lib with monsters installed-but-disabled: `monsterExtras`
facade falls back to raw flags (vision/speed still resolve).

## Phase 3 — Plumbing adoption

Per-module, parallelizable; patch/minor bumps, independent timing.

- **acks-henchmen:** `scripts/rules/tables.mjs` becomes a lazy delegation shim
  over `acksLib.tables` (its ~6 importing files stay untouched);
  `scripts/sockets.mjs` → thin wrapper over `createGmRelay` (keeps
  `registerSocketAction`/`executeAsGM` names); `scripts/effects.mjs` re-layered
  over the lib collector (influence-bridge + NAME_FALLBACKS composition stay
  module-side); header button via `acksLib.ui`.
- **acks-equipment:** add `requires acks-lib`; `scripts/effects.mjs` collector
  core → lib (Loadout-AE builder stays); `tools/test-logic.mjs` keeps passing
  via sibling-relative lib import.
- **acks-formation:** `scripts/socket.mjs` → lib relay (pre-ready queue
  semantics are in the lib by design).
- **acks-influence:** inline socketlib block (`scripts/module.mjs`) → lib
  relay; header button via lib helper with its current anchor.

**Verify:** validate per repo; equipment `npm test`; Foundry smoke —
player-client GM-relay round-trips (henchmen recruit/hire, influence
hidden-target roll, formation fog-reload message); henchmen throw-dialog
modifier rows identical before/after.

## Phase 4 — Data externalization (ruledata rollout, premium-ready)

All loads via `acksLib.loadRuledata` at `setup`; all access via the lib
registry (so premium catalogs can override, FAMILY.md §5). JSON conventions
from henchmen: top-level `id`, `source` book cites per table, `null` = open
bracket bound (also solves JSON-less `Infinity`), regexes as pattern strings
compiled at use.

| Module | New ruledata files | Extracted from | Stays in code |
| --- | --- | --- | --- |
| influence | `modifiers.json` (INFLUENCE_MODIFIERS), `bands.json` (bands, attitude ladder, relationship mods, time steps), `aging.json` (AGE_TABLE) | `scripts/constants.mjs`, `scripts/actor-data.mjs` | tone enums, flag/hook keys, PROFICIENCY_MATCHERS; the `computeDefaults(actor, target, modConfig)` seam already exists |
| equipment | `weapons.json` (WEAPONS + aliases + focus groups), `shields.json` (SHIELD_VARIANTS), `masterwork.json` (MASTERWORK) | `scripts/config.mjs` | size/style/category enums, STYLE_SPEC_BONUS, ARMOR_LADDER/ARMOR_GATED_SKILLS vocabulary |
| formation | `thief-progression.json`, `light-sources.json` (consume patterns as strings), `exploration.json` (SPEED_TIERS, null maxStone) | `scripts/constants.mjs` | turn scalars, ROLES, PARTY_CHECKS (behavior wiring) |
| henchmen | — already externalized | — | optional later: NAME_FALLBACKS → JSON (defer) |
| monsters | — none (schema-bound) | — | everything |

**Verify:** validate (ruledata JSON + i18n-key checks already synced); grep
proves the old consts are gone; behavior-identity smoke (one influence roll per
tone, one styled equipment attack, one formation turn with torch burn —
identical results); editability smoke: change one number in a ruledata file,
reload Foundry, observe it live; equipment `npm test` loads JSON from disk.

## Phase 5 — Pack pipeline convergence

Clears the TOOLCHAIN §8 deviations.

- **acks-formation:** move inline content of its custom `tools/build-packs.mjs`
  (WANDERING/MATRIX/PROFICIENCIES + doc factories) into `tools/pack-data.mjs`
  **preserving `_id`s verbatim**; next `/acks-sync-toolchain` installs the
  canonical harness (existing COPY_IF_PACK_DATA rule fires). The `master`
  branch rename stays a separate deliberate GitHub-side step.
- **acks-influence:** same extraction for its custom builder (macros; the
  proficiencies moved to the lib in Phase 2).
- **Template:** empty the TOOLCHAIN §8 deviations table.

`_source` stays a generated artifact — `ruledata/` is the human-editable
surface; pack content keeps JS factories for deterministic ids/`_key`s.

**Verify:** rebuild → `_source` diff empty or provably cosmetic (ids
preserved); LevelDB packs open in Foundry; release-workflow dry run per repo.

## Phase 6 — Docs polish + future groundwork

- Equipment `docs/MODEL.md` §5/§6 rewritten to the lib-mediated reality
  (spendGold via `acksLib.economy` backlog, damage-type vocabulary via lib
  contract; `// TODO: migrate to acks-lib` markers resolved).
- FAMILY.md premium-companion pattern reviewed against the first real catalog
  design; upstreaming checklist reviewed.
- Skeleton CLAUDE.md render mentions lib + ruledata conventions.

## Open rulings

- **Signing-bonus week formula** — recommended canon: day-consistent
  (day = monthly/30, week = 7×day, henchmen's current form). Recorded in
  henchmen `docs/RULES.md` during Phase 0; acks-domains adoption is a
  follow-up outside this plan.
- **`compatibility.minimum` values** for each module's `requires acks-lib` —
  set at Phase 2/3 release time to the lib version actually consumed
  (expected `1.0.0`).
- **check-family.mjs strictness during transition** — advisory in Phase 1,
  enforcing from Phase 2.
