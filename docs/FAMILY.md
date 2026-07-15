# ACKS Module Family — Architecture

Companion to [TOOLCHAIN.md](TOOLCHAIN.md) (build/release mechanics). This page
records the *proposed target architecture* for the module family — tiers,
dependency rules, and data ownership — drafted 2026-07-15 and stored for
review.

> **STATUS: PROPOSAL — NOT IN EFFECT.** If you are developing a module today,
> **nothing changes for you.** [TOOLCHAIN.md](TOOLCHAIN.md) remains the only
> canon in force; this page imposes zero rules until
> [REFACTOR_PLAN.md](REFACTOR_PLAN.md) phases execute on explicit owner
> go-ahead. Conflicts between current repos/docs and this page — e.g. a
> module's MODEL.md planning a cross-module API call — are **expected** and
> stay valid; they are resolved by the phases, not by ad-hoc conformance
> edits. Do not rework code or docs to match this page preemptively. This
> banner is updated as phases land.

## 1. Governing vision

1. **Strict hierarchy — zero module↔module dependencies.** A mutual dependency
   between two modules is a defect signal with exactly two remedies: extract
   the shared piece into the library, or merge the modules. (2026-07 audit:
   no merges needed — the influence⇄henchmen entanglement dissolves entirely
   into the library.)
2. **One required library, which itself `recommends` all the modules.**
   Every module `requires` acks-lib and names no sibling, ever. The library is
   the only code in the family allowed to know the modules' ids; all interop
   is mediated by lib contracts.
3. **The library is a staging ground for the core engine.** Its stable parts
   get upstreamed into foundryvtt-acks-core over time; acks-lib then defers to
   core (`game.acks?.lib` shim) and the modules never change. The lib API is
   designed core-shaped from day one.
4. **End-state: modules are independent rule-automation efforts**, each with
   companion **premium modules** that load/stream the full catalog of published
   content/tables they consume. The data layer therefore treats module-shipped
   tables as replaceable samples and supports registration/override by content
   companions.

## 2. Dependency DAG

Strict, acyclic, no sibling edges:

```
acks (system) ─────────── eventual home of the lib's stable parts
   ▲ requires
acks-lib ──────────────── REQUIRED by every family module; recommends all of them
   ▲ requires (each module; no other family edges permitted)
acks-equipment  acks-formation  acks-henchmen  acks-influence  acks-monsters
   ▲ requires (future, one per module)
acks-<module>-catalog … premium companions: full published content/tables
```

Third-party edges stay where real: `lib-wrapper` (equipment, formation),
`socketlib` (formation, influence; henchmen `recommends` — native fallback
exists). Formation's legacy `recommends acks-monsters` is removed once lib
mediation lands (REFACTOR_PLAN Phase 2).

### Hierarchy invariants (target state — enforced by `bin/check-family.mjs` from REFACTOR_PLAN Phase 2; no force before then)

- No family module.json declares another acks-\* module, with exactly three
  allowed edge kinds: module → acks-lib `requires`; acks-lib → modules
  `recommends`; catalog → its automation module `requires`.
- No module source contains `game.modules.get("acks-<sibling>")` — only
  acks-lib may probe family module ids.
- Sanctioned mirrors stay value-identical (currently one: acks-monsters
  `MONSTER_SAVES_LUT` vs core `CONFIG.ACKS.monster_saves`, key-remapped).
- If two modules keep needing each other *through* the lib in both directions
  for logic (not data), that pairing is flagged for merge review.

## 3. acks-lib contract

Identity: sixth family repo, module id `acks-lib`, `library: true`,
`socket: false` (relays run on consumers' channels), requires only the system,
`recommends` all five modules with reasons. Namespaces per TOOLCHAIN §5b:
JS/global `acksLib`, pack `_id` short key `acksLib`.

### 3a. Plumbing (ported from the modules, parameterized)

| Lib file | Provenance | Notes |
| --- | --- | --- |
| `scripts/tables.mjs` | `acks-henchmen/scripts/rules/tables.mjs` verbatim base | pure, Foundry-free, Node-importable; adds registration **priority** (same doc id: highest wins — module samples 0 < premium catalog 10 < world override 20) |
| `scripts/ruledata.mjs` | henchmen `module.mjs` setup fetch loop | `loadRuledata(moduleId, ids, {priority})` |
| `scripts/socket-relay.mjs` | union of henchmen `sockets.mjs` (socketlib-or-native fallback, GM dedupe) + formation `socket.mjs` (pre-ready queue) | `createGmRelay(moduleId, opts)`; channels stay per-consumer (`module.<id>`) |
| `scripts/effects.mjs` | generic core shared by henchmen/equipment `effects.mjs` | AE collector parameterized `{moduleId, domain, nameFallbacks}`; module-specific layers stay module-side |
| `scripts/sheet-header.mjs` | henchmen header-button idiom | dedupe-guarded header/section injection, options bag for anchor |

### 3b. Interop (the inversion that enables the hierarchy)

- **`acksLib.services`** — named-contract registry. Providers push
  `register("<contract>", impl)` at `init`; consumers `get("<contract>")` from
  hooks onward. Contract names and shapes are defined in the lib's
  `docs/API.md`, never by module ids. v1 contracts:
  - `reaction` — provided by acks-influence: `open(actor, {targetActor,
    modifiers})` plus the roll-complete payload.
  - `monster-extras` — provided by acks-monsters: `getExtras(actor)`.
- **Facades with fallbacks live in the lib.** The lib may know module flag
  schemas; modules may not know each other's. `acksLib.data.monsterExtras(actor)`
  = registered service if present → raw `flags["acks-monsters"].extras` read
  (covers the installed-but-disabled case formation relies on) → `null`.
- **Canonical hook names are defined by the lib** (camelCase-namespaced per
  TOOLCHAIN §5b, e.g. an `acksLib…`-prefixed reaction-complete hook). Providers
  fire the lib-defined name; legacy module-namespaced hooks dual-fire for one
  transition release. Core-shaped on purpose — these are the names proposed for
  upstream (`acks…` prefix) later.
- Backlog: `acksLib.economy` — `spendGold`/`grantGold` actor-money math
  (currently in henchmen's adapter; wanted by equipment's purchase macro).

### 3c. Shared data & content (the "shared third module" resolutions)

- **`ruledata/economy.json`** — the Henchman Monthly Wage ladder
  (`henchmanWageByLevel`) + signing-bonus fractions, canonized day-consistent
  (day = monthly/30, week = 7×day). Henchmen's `wages.json` keeps
  hireling-specific tables and drops the ladder; influence deletes its mirror.
  Both read the lib table — no fallbacks, the lib is required.
- **`packs/_source/social-proficiencies/`** — the six merged proficiency items
  (Beast Friendship, Bribery, Diplomacy, Intimidation, Mystic Aura, Seduction):
  `acksLib` `_id` prefix, RAW names, henchmen's descriptions (RR cites),
  `effects` = the union of both modules' effect documents. Each flag namespace
  (`flags.acks-influence.*`, `flags.acks-henchmen.*`) is inert when its module
  is absent, so one item serves any install combination. Influence and henchmen
  ship none of these.

### 3d. Exposure, load order, versioning

- `globalThis.acksLib` is assigned at module-scope evaluation;
  `game.modules.get("acks-lib").api = { apiVersion, tables, loadRuledata,
  createGmRelay, effects, ui, services, data }` at `init`.
- **Core-deferral shim from day one:** `globalThis.acksLib = game.acks?.lib ??
  localImpl` — when a surface is upstreamed, the lib transparently defers and
  consumers never change.
- **Load-order contract:** consumers touch `acksLib` only from hooks (`init`
  onward — Foundry evaluates all esmodules before any `init` fires), never at
  module top-level scope. Node tooling/tests import sibling-relative paths
  (`../../acks-lib/…`), the side-by-side layout the toolchain already assumes.
- **Versioning:** lib semver + `api.apiVersion`; every consumer pins
  `compatibility.minimum` on its `requires` entry. A breaking lib change is a
  major bump with coordinated consumer updates — that discipline is the price
  of a single live copy, accepted deliberately.

## 4. Ownership (one-to-one)

| Data / functionality | Owner |
| --- | --- |
| Shared plumbing, interop contracts, canonical hooks | acks-lib |
| Wage ladder + signing-bonus fractions | acks-lib `ruledata/economy.json` |
| Social proficiency items (the six, dual-namespace) | acks-lib pack |
| Hireling tables (mercenary/officer wages, availability, loyalty, names…) | henchmen `ruledata/` |
| Reaction rolls, attitude tracking, reaction-AE convention (`flags.acks-influence.*`) | influence (registers `reaction`) |
| Monster extras schema + vocabulary enums | monsters (registers `monster-extras`; schema in its `docs/API.md`; raw-flag reads only via the lib facade) |
| Monster saves LUT | core `CONFIG.ACKS.monster_saves`; monsters keeps a documented mirror + `ready` drift warning |
| Weapon/shield/masterwork profiles | equipment (→ `ruledata/`, REFACTOR_PLAN Phase 4) |
| Exploration tables (thief progression, light, speed, wandering) | formation (→ `ruledata/`, Phase 4) |
| Hiring/loyalty AE convention (`flags.acks-henchmen.*`) | henchmen |
| Encumbrance→speed, light/ration/turn consumption | formation |
| Equip limits, fighting styles, draw/sheath economy | equipment |

## 5. Premium companion pattern (documented now, built later)

`acks-<module>-catalog` `requires` its automation module (which requires
acks-lib). At `setup` it registers full ruledata documents at priority 10 —
overriding the module's sample tables by doc id — and/or ships compendium packs
of published content whose automation flags follow the documented AE
conventions. Two obligations this places on the automation modules:

- all table access goes through the lib registry (never a direct import of the
  module's own JSON), so a catalog can substitute data without code changes;
- module-shipped tables are framed as replaceable sample/SRD-safe defaults.

Distribution/licensing of premium content is out of scope here.

## 6. Upstreaming path

Graduation candidates, roughly in order: the tables registry (core already has
the `ruledata/internal_tables.json` pattern), canonical hooks (e.g. the
pre-roll-attack shape equipment's MODEL.md proposes), economy helpers, the
sheet-injection helper, `economy.json`, and folding the social-proficiency
automation flags into core's existing proficiency pack items.

Mechanism per surface: upstream PR to AutarchLLC → on acceptance the lib's shim
defers to `game.acks.lib` for that surface → modules unchanged. The lib shrinks
toward a compatibility shim as core absorbs it. Timelines are deliberately not
scheduled here.

## 7. Do-not-change list

Things that look duplicated or dirty but are correct:

- **Per-module AE flag namespaces, socket channels, `globalThis.acks<Name>`
  aliases** — parallel *architecture* by design (TOOLCHAIN §5b), not
  duplication.
- **henchmen `NAME_FALLBACKS` + influence `PROFICIENCY_MATCHERS`** —
  independent name-detection safety nets for hand-made items; regexes are code
  per the ruledata design rule.
- **equipment `WEAPONS` table vs core weapon packs** — documented last-resort
  fallback after core tags and per-item flags; complementary, not duplicate.
- **formation `THIEF_PROGRESSION` vs core class-ability packs** — different
  representations of the same book table; extract to ruledata for
  *editability*, not for dedupe.
- **monsters' schema-bound config** (`BODY_FORMS`, `SPECIAL_ABILITIES`, vocab
  enums) — feeds DataModel `choices` at `init`, before any fetch could
  complete; stays in code by rule.
- **Committed `packs/_source` + committed LevelDB** — per TOOLCHAIN §2;
  `_source` is a build artifact, `ruledata/` is the human-editable surface.
- **The core system** — zero changes except deliberate upstream PRs (§6).
