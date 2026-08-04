# Family Decision Record

Dated rulings about the **shape of the family itself** — how many repos there
are, what may depend on what, and what a shared surface is allowed to be.
[TOOLCHAIN.md](TOOLCHAIN.md) states the conventions in force; this page records
why they are those conventions, and which alternatives were tried and abandoned.

**Read this before a structural change** — splitting or merging a repo, adding a
dependency edge, moving a shared surface, changing what ships. Ordinary module
development needs TOOLCHAIN.md and nothing here.

Append-only. A superseded entry stays, marked: knowing an option was tried and
abandoned is the point. Decisions internal to one repo live in that repo's own
`docs/DECISIONS.md` and are not repeated here.

---

## 2026-08-01 — Eight modules become one — IN FORCE

The five feature modules and the three that had grown alongside them
(`acks-abilities`, `acks-lib`, `acks-location`) were merged into a single repo,
`foundryvtt-acks-extras`, module id `acks-extras`. Each became a subsystem under
`scripts/<feature>/`; the library became `scripts/lib/`. On 2026-08-02
`acks-content` was likewise renamed and re-homed as `foundryvtt-acks-importer`
(`acks-importer`).

**What this dissolved.** Every problem the 2026-07-15 architecture program
existed to solve was a consequence of the module count, and stopped existing
with it:

- Module↔module dependencies could no longer be cyclic, undeclared, or
  mediated — there is one module.
- The lib is imported directly, at a relative path inside the same tree. There
  is no `requires acks-lib` edge, no `apiVersion` handshake, no installed-but-
  disabled case, and no version skew between a lib surface and its consumer.
- Data duplicated between siblings (the wage ladder, the six social
  proficiencies, the monster-saves mirror) had exactly one place to live.
- Copy-pasted plumbing — three GM socket relays, two effect collectors, three
  sheet-header injectors — collapsed into one implementation each.

**What it cost.** A user installs one large module rather than choosing
features. Feature areas can no longer be released independently: one version
number covers all eight, so a fix in one subsystem ships the current state of
every other. That is the trade accepted, and the live gate (TOOLCHAIN §4a) is
what makes it survivable — a release now has more surface to break.

**What replaced the enforcement.** The hierarchy was to have been policed by a
`bin/check-family.mjs` linting manifest edges and cross-module `game.modules.get`
probes. It was never written and is not needed. The equivalent guards now live
in the merged repo's own `tools/validate-extra.mjs` (no stale family ids in
code, flag-call scopes resolved to their declared value, one libWrapper
registration per target) — an in-repo check, which is the only kind that can
still fail meaningfully.

**The one edge that remains.** `acks-importer` `requires acks-extras`: it
imports book content into documents and tables that extras owns and renders.
The dependency is one-directional and declared. Extras must never name the
importer — a world with extras alone is the supported configuration, and the
importer is how content gets in, not a condition of anything working.

## 2026-07-15 — Strict hierarchy over a standalone `acks-lib` — SUPERSEDED (2026-08-01)

A full-family audit proposed a five-module DAG with zero sibling edges: a sixth
repo, `acks-lib`, that every module would `require` and that alone would know
the other modules' ids; all interop through a named-contract service registry;
premium content companions layered above each module; the lib's stable parts
upstreamed into the core system over time. A staged seven-phase migration plan
accompanied it.

**Status: superseded by the merge.** Both pages (`FAMILY.md`, `REFACTOR_PLAN.md`)
were deleted 2026-08-04, having sat banner-marked "PROPOSAL — NOT IN EFFECT" for
their whole life. Only Phase 1 ever partially ran: `acks-lib` was scaffolded
2026-07-18 as a scoped v0.1 carrying shared vocabulary and DataModel field
builders, then grew a tables registry and services contract (v0.7.0,
2026-07-19). The rest — hierarchy adoption, plumbing adoption, data
externalization, pack-pipeline convergence — never executed as written. The
merge reached the same goals by removing the boundaries instead of governing
traffic across them.

**Why it was the wrong shape, in hindsight.** The plan's own audit found the
five modules were entangled in both directions through undeclared edges. It
treated that as a mediation problem. It was a boundary problem: the modules were
one product split five ways, and every mechanism the plan proposed — the service
registry, the fallback facades, the `apiVersion` handshakes, the lint that
would police it — was overhead paid to keep a split nobody wanted.

**What survives from it, and where it now lives:**

- *Overrides of core logic belong in one place* → TOOLCHAIN §6, now naming the
  `lib` subsystem rather than a repo.
- *One owner per wrapped core method* → TOOLCHAIN §6, unchanged and still the
  rule the merge made easy to keep.
- *Never feature-detect a nested API path into silence* → TOOLCHAIN §10a.
- *Upstreaming into the core system* → below, still open.
- *Premium content companions* → below, deferred.

**What did not survive, deliberately:** the dependency DAG, the sanctioned-mirror
register, the `acksLib.services` named-contract registry as an inter-repo
mechanism (it exists as `scripts/lib/services.mjs`, an intra-repo seam), the
`ruledata/economy.json` wage ladder (superseded again, below), and the
`check-family.mjs` lint.

## 2026-07-19 — No value read from a book ships in any repo — IN FORCE

An audit of the then-`acks-henchmen` found it shipped rules tables as
`ruledata/*.json`, publicly, in the repo and in every release zip. As in-app
content of an ACKS II App this is permitted under App License §2 — past releases
were not violations. But a public repo also serves those files as raw JSON to
people who never run the app, which is in tension with the licence's bar on
publishing the database separately.

**Ruled:** no table value read off a page ships in any repo, at all. Not as
`ruledata/`, not as sample data, not as a fallback. This is stricter than the
licence requires and was adopted deliberately, because the machinery to do
without it exists: content is expressed as **extraction instructions** —
geometry and patterns, never values — and a GM whose seat owns the book imports
it. The materialized tables persist as **world data**, so from then on the
mechanics serve everyone in that world, bookless seats included. Descriptive
prose never persists; it stays seat-side, gated on the defining book.

Corollaries still in force:

- **No fallback samples.** A world without an imported table gets a stub and a
  pointer to import, never an SRD-safe approximation.
- **Automation vocabulary stays code**, by rule: flag keys, effect names,
  outcome enums, name-matching regexes, formulas. Only book-read values and
  structures go through extraction. `acks-extras` ships no `ruledata/` at all.
- **Compendium packs are a different question** and were not part of the purge:
  pack items are App License §2 in-app content and stay, unshipped only if and
  when an import path replaces them.
- The back catalogue was purged rather than left: `ruledata/` was rewritten out
  of that repo's git history, old releases and tags deleted, and releases
  resumed on the clean tree.

This superseded the 2026-07-15 proposal's `ruledata/economy.json` — a shared wage
ladder shipping in the lib — which was never authored.

The extraction machinery now lives in `acks-importer` (cookbooks, recipes, book
fingerprints); its design is documented there, not here.

## 2026-07-16 — Rules extracts never enter a repo — IN FORCE

The public repos were indexed online while carrying markdown extracts of
licensed book text. The extracts were purged from every repo's git history on
2026-07-16 and the repos went private until clean.

Extracts live only at `C:\Proj\acks-rules\<feature>\` on the developer's own
machine — never committed, never shipped, one directory per feature. The
mechanism that keeps it that way is `tools/ip-scan.mjs` plus a pre-commit
quarantine hook; the full account is [LICENSING.md](LICENSING.md) §3, which owns
this and is not repeated here.

The same rule covers `TEST_ENVIRONMENT.md`: no port, world id, user name or
password reaches any repo, skill, commit message or memory.

## 2026-07-19 — Compiled packs are build output, not source — IN FORCE

Compiled LevelDB pack directories were committed for the family's first year,
for no benefit: the release workflow rebuilt them before zipping, so what was in
git was never what shipped. They cost timestamp churn on every build, binary
bloat, and a repo that went dirty whenever a running Foundry world held the
LevelDB locks.

They are now gitignored and rebuilt by CI. The operational consequences —
`packs/_source` is generated too, a fresh clone must run `build:packs`, and the
compiled dirs must stay in the zip because Foundry cannot read `_source` — are
TOOLCHAIN §2 and §1, where anyone doing basic dev will meet them.

## 2026-07-31 — The playtest batch: incidents behind the standing rules

Six GM-reported bugs were diagnosed and released together on 2026-07-31, across
what were then five separate repos (`acks-lib` 0.37.0, `acks-content` 0.62.0,
`acks-equipment` 0.35.0, `acks-formation` 0.26.0, `acks-henchmen` 0.28.0). Each
became a standing rule in TOOLCHAIN §10. The rules are stated there in the
present tense and repo-agnostically; the incidents are recorded here because
what a rule cost is not something a rule can say about itself.

- **A capability probe that could never be true.** `acks-formation` gated
  capability matching on `globalThis.acksLib.satisfies`; the function lived at
  `acksLib.vocab.satisfies`. The probe returned false for weeks and the whole
  matching layer degraded invisibly — every imported skill fell back to a
  default, mislabelled and unbonused. The seam carried a "verified by execution"
  audit note and had never once fired. → TOOLCHAIN §10a.
- **Six figures of back wages.** `acks-henchmen` billed wage months as
  `now − (lastPaidTime ?? 0)`, so a henchman predating the module was invoiced
  for every month since worldTime zero. → TOOLCHAIN §10b.
- **The same payday, escalating.** It then converted "the employer cannot afford
  this (wrong) bill" into missed-wage calamities for the whole retinue,
  silently. → TOOLCHAIN §10c.
- **An effect that outlived its module.** `acks-equipment` left a managed Active
  Effect applying stale AC and attack modifiers forever after the module was
  disabled, and nothing told the user that disabling cost anything. →
  TOOLCHAIN §10d.
- **A feature whose halves shipped a week apart.** `acks-abilities` 0.10.0
  shipped code reading a lib constant whose defining half sat uncommitted in a
  working tree for a week. Guarded reads made the gap invisible rather than
  acceptable. → TOOLCHAIN §10e. (The merge removed this failure mode inside
  `acks-extras`; it remains live across the extras↔importer edge.)
- **The module with a walkthrough was the one that got praised.** The playtest
  report singled out the single README carrying numbered getting-started steps
  and filed the missing ones as bugs. → TOOLCHAIN §10f.

Absorbed with the batch, and cheaper to remember than to rediscover:
`foundry.utils.duplicate()` strips getters, so a duplicated document snapshot
has `_id` but no `id`. A card grid stamping `data-item-id="${h.id}"` rendered
`"undefined"` and the click handler swallowed it.

## 2026-08-01 — Short keys stopped being unique across the family — ACCEPTED

TOOLCHAIN §5b required each repo's pack `_id` short key to be unique family-wide,
so an id in a bug report would grep back to exactly one owner. The merge
collapsed nine declared keys into one, and both surviving repos declare `acks`.

Accepted rather than fixed. A pack document `_id` need only be unique within its
pack, and the two repos' packs never merge, so nothing breaks. What is lost is
the grep property: an `acks…` id no longer says which of the two modules it came
from. Renaming one would rewrite every shipped `_id` and orphan every world
document referencing them — a migration whose cost is real and whose benefit is
a search convenience.

## Upstreaming into the core system — OPEN

The `lib` subsystem was conceived as a staging ground for the core engine: its
stable parts upstreamed into `foundryvtt-acks-core` over time, with the module
deferring to core once a surface lands there. Candidates, roughly in order: the
tables registry (core already has an internal-tables pattern), canonical hook
names, economy helpers, the sheet-injection helper.

Nothing has been upstreamed and no timeline is set. The mechanism, if it
happens: an upstream PR to AutarchLLC, and on acceptance the lib surface becomes
a shim deferring to core so callers do not change.

**Unchanged either way:** the system repo is a read-only reference. No module
task edits system source — not to fix a bug, not to add a hook. Core changes only
under an explicitly approved core-side program (TOOLCHAIN §6).

## Premium content companions — DEFERRED

The 2026-07-15 proposal described `acks-<module>-catalog` companions that would
register full published tables over a module's samples. Two of its premises are
gone: there are no per-module repos to hang a companion off, and the 2026-07-19
ruling means there are no sample tables to override.

The need it addressed is met differently — `acks-importer` materializes tables
into world data at import time, from the GM's own books. A commercial content
companion remains possible and is not planned. Distribution and licensing of
such content was never in scope here.
