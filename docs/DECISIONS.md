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

## 2026-08-04 — A shared check must report what it checked — IN FORCE

`acks-importer` shipped `ACKS-IMPORTER.ui.connectNoBook` referenced in code and
absent from `lang/en.json`, past a `npm run validate` that exited 0. The check
was not broken for that key; it was inert for that repo. It matched quoted
literals only, and the repo names its root through a constant —
`` game.i18n.localize(`${LANG_PREFIX}.ui.connectNoBook`) `` — the shape the
skeleton itself seeds. Zero keys were found, so zero keys were missing, and the
run was green. `acks-extras` was in the same state for its `lib` and `location`
subsystems without anyone noticing, because its other subsystems write literals
and kept the section looking busy.

**Ruled.** The i18n pass resolves the roots the family actually writes:
constants followed across named imports, roots chained off other constants, and
prefix-bound localizers. A root it cannot resolve is a `FAIL`, not a skip.

**And the general rule behind it:** a shared check states its coverage. This one
prints the number of keys it checked on every run, pass or fail. The defect was
never a wrong answer — it was an answer of "nothing to report" that read as
"nothing is wrong", and no amount of care in the matching would have surfaced
that. Any check added here that can be silently inert owes the same line.

**Rejected — a repo-wide `IDENT → value` map.** Simpler, and wrong for merged
modules: `acks-extras` declares three different `LANG_PREFIX` constants
(`ACKS-LIB`, `ACKS-LOCATION`, `ACKS-ABILITIES`). Flattening them attributes keys
to whichever file was walked last. Resolution is per file, or it is misleading.

**Cost.** Section 6 grew from ~35 lines to ~130 and now carries a resolver with
a fixed-point pass. It is regex over sources, not a parser, so it reads the
idioms in use and no others: a root arriving as a function parameter, through
`import * as ns`, or assembled at runtime stays out of reach. The first two are
detected and fail; nothing silently returns to inertness.

**Found on landing.** Two live defects, both rendering as raw key text in the
UI: `ACKS-IMPORTER.ui.connectUnfilled` (`scripts/module.mjs`, a `notifications.
warn`) and `ACKS-LOCATION.sheet.location` (`scripts/location/apps/
location-sheet.mjs`, the Location sheet's name in sheet config).

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
*(Superseded 2026-09-01 — "Two modules become one", below: the edge closed.)*

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

## 2026-08-05 — The worktree that renamed a repo, and the sync that ran ahead of the push — IN FORCE

Two flaws with one root — rules keyed on transient local state — kept module CI
red and sent live-testing sessions chasing a directory that does not exist.

First: `sync-toolchain.mjs` rendered `{{REPO_DIR}}` as `path.basename()` of the
directory being synced. A session running inside a Claude worktree
(`.claude/worktrees/gallant-leavitt-73353f`) committed a CLAUDE.md whose Foundry
junction target and release-manifest URL both named the worktree instead of
`foundryvtt-acks-extras` — so the dev-install instruction pointed at a
nonexistent path and the release-verification URL could only ever 404. The
extras repo answered with its single-branch guard (its DECISIONS §12) but the
poisoned render itself stayed committed. **Ruling:** `REPO_DIR` renders from
`module.json`'s `url` (canon pins it to `https://github.com/NocTempre/<repo>`),
falling back to the directory name only when `url` is absent. Nothing rendered
into a repo may derive from the syncing session's cwd.

Second: the `acks-sync-toolchain` skill ordered work as sync → commit modules →
commit template last, "do not push unless asked" — the exact inversion of the §9
operating rule written after 2026-08-01, and it reproduced that failure: modules
synced from an unpushed template commit fail `toolchain-check` on every push
(local `--check` green, CI red) until the template reaches GitHub. **Ruling:**
the skill now pushes the template before applying downstream, and pushes each
synced module. A skill that encodes a procedure owns the procedure's ordering
rules; §9 stated the rule, but the skill was what sessions executed.

Same sweep: the extras single-branch guard (hook + settings + conventions text)
is promoted to canon — it answers a family-wide failure mode, and as a repo-local
customization of two COPY/RENDER files it made extras drift permanently red,
training sessions to ignore the drift check. The stale `git restore packs/ &&
git clean -fd packs/` guidance (superseded 2026-07-19 when compiled packs left
git) is deleted from the two skills and the sync header that still carried it.

## 2026-08-12 — The hygiene-sweep batch: incidents behind §10h/§10i and the §10a rewrite

The 2026-08-07 hygiene sweep (36 findings across extras and importer) promoted
three lessons into TOOLCHAIN §10 and rewrote one clause that was wrong. As with
the playtest batch, the rules are stated there; what they cost is recorded here.

- **A recipe fix that never took effect.** `acks-importer`'s cookbook wrote
  conditionally-built objects back via `Document#update()`; Foundry deep-merges,
  so a recipe that narrowed or removed a field never retracted it from
  previously-imported documents — no matter how many times Refill/Update re-ran.
  Paid for twice in the same file; the team's own explicit-write fix for the
  `unaudited` flag was never generalized to the other seven conditional keys.
  Shipped as importer 2.4.5 ("an update takes back what the page no longer
  says"). → TOOLCHAIN §10h.
- **Two false Criticals from a plausible mechanism.** The sweep rated two
  per-render `DragDrop` re-instantiations Critical on an accumulation theory —
  duplicate drops, duplicated party members. Verified against v14 build 365:
  `DragDrop#bind` assigns by IDL property (`element.ondrop = …`), so re-binds
  overwrite and can never stack. The findings were refuted, the sweep's context
  text corrected, and the lifecycle written into canon as convention rather
  than corruption guard. → TOOLCHAIN §10i.
- **The one sanctioned edge was told to do what is forbidden everywhere else.**
  §10a prescribed a junction-safe relative import for the importer→extras edge;
  the family's own cross-package-coupling doctrine calls exactly that shape a
  bug, and zero code ever did it — practice uses `globalThis.acksExtras`, but
  with silent per-call-site fallbacks §10a exists to prevent. Canon was
  corrected to match the working mechanism and demand the missing discipline:
  resolve once at ready, absence is a load-time failure. → TOOLCHAIN §10a
  (amended).

Absorbed with the batch: the "one libWrapper registration per target" gate is a
literal-text regex that a raw prototype monkeypatch is structurally invisible
to, and §3's `relationships.requires` reason rule had zero corresponding code in
validate — both instances of the 2026-08-04 ruling not yet generalized beyond
the i18n pass. The ruling's scope is now stated as general in TOOLCHAIN §5.

## 2026-09-01 — Two modules become one — IN FORCE

`acks-importer` became the `scripts/importer/` subsystem of `acks-extras`
(its cookbook at `cookbook/`, its authoring register at `register/`, its
tooling at `tools/importer/`, its docs at `docs/importer/`). The repo
`foundryvtt-acks-importer` is a read-only archive of the pre-merge history and
releases; `DEFAULT_TARGETS` names one repo.

**Why.** The 2026-08-01 ruling kept the importer separate on the argument that
extras alone was the supported configuration and the importer merely how
content got in. A month of releases showed the line did not hold: every extras
feature that reads a printed value declares a table the importer must fill,
every class, race, trap, variation and vehicle the importer writes is a
sub-type extras owns, and both repos had to release in step for either to work
(§10e was the standing cost). Two version numbers described one product; the
"extras alone" world was one with no book content in it. Same shape as the
five-way split the first merge dissolved: a boundary nobody wanted, paid for
in coordination.

**What dissolved.** The last family edge; the tag-first rule as a live
obligation; every `globalThis.acksExtras?.…` probe in the importer (now static
relative imports); the two flag scopes an imported document carried; the
`acks-importer` settings namespace; the second macro compendium; the twinned
issue forms; two changelogs, two galleries, two live-test suites.

**What it cost.** A world that imported under the separate module holds
thousands of documents stamped in a scope no module owns — the identity every
class ref, dedup check and library read depends on. Unlike the first merge,
this could not be a clean break: the stamps ARE the library. Ruled: a one-shot
migration on the primary GM (documents at every embedded depth, the three
world settings, the two client settings per seat, world macros addressing the
retired global), recorded in a world setting, with the merged importer YIELDING
entirely while the old module is still active so two importers never write one
library. The importer's `generated` flag key was renamed `minted` on the way,
because extras already used `generated`. The extras repo's own
`docs/DECISIONS.md` carries the mechanics and the rejected alternatives.

**What this does not change.** Structure ships, content is imported
(2026-07-19) — the cookbook is instructions, the values still arrive from the
GM's own copy. The IP gates run unchanged over the same files at new paths.

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

## 2026-08-14 — Release snapshots are documentation, not immutable records

**Ruled:** a past release's `docs/releases/v*/` directory may be rewritten
where the surface it shows has changed. The owner rejected the previous
"never rewrite a past release's directory" clause; the only snapshot economy
rule is the kind table — a minor release never has to re-capture surfaces its
changes did not touch. §4b and the acks-release skill amended to match.

## 2026-08-15 — Math may ship; the book's words may not — IN FORCE except its citation clause (superseded 2026-09-03)

**Why this is stricter than it has to be.** These modules are licensed, and
nothing here is a compliance minimum. The owner is deliberately prototyping a
doctrine that would satisfy an ANTAGONISTIC rights holder — one reading every
string looking for a reason — rather than the one actually granting the licence.
Read the rules below in that light: they are an experiment in how far a
third-party module can be pushed toward holding no book content at all, and the
cost of a false positive here is a thinner tooltip, not a lost right. Do not
relax them because a particular case looks legally safe. It almost certainly is.
That is not the bar being aimed at.


The "no value read off a page" rule sat next to the `ruledata/` prohibition and
was read as being about pack data and tracked data directories. It never reached
`lang/` strings or frozen tables in a `config.mjs`, so both accumulated —
`acks-extras` shipped a five-row masterwork price table, a shield-variant table,
a silver multiplier, and hint strings that paraphrased rules and cited page
numbers. The 4.9.0 trap work added more of the same before anyone noticed the
pattern. Owner ruling, 2026-08-15: this is a minor IP leak, and the rule needs
to say so out loud.

**The test, in three questions, applied in order.**

1. **Is it a sentence about the rule?** Then it does not ship. A hint, a label,
   a tooltip or a chat line that states, explains or paraphrases what the book
   says is the book's expression, and so is any page citation. Say what the
   FIELD does instead — "In feet." rather than "A pit deals 1d6 per 10 feet
   fallen" — or get the words from the importer.
2. **Is it a value read off a page?** Then it does not ship either. A modifier's
   size, a botch band's edge, a rate, a price, a ladder rung, a table of options
   a reader picks from. However small, however alone: +2 for a crowbar is as
   much a printed number as a fifty-row price list. These arrive through
   `acks-importer` from the GM's own copy and are PASSED IN.
3. **Otherwise it is the procedure, and the procedure ships** — in the function
   that performs it. Which modifiers exist, when each applies, how they combine,
   what a failure costs, what resolves in what order.

**The pattern to copy is `formation/jumping.mjs`.** It knows that a proficiency
raises the score a jump is figured from, that a cap exists, and that the landing
is a Paralysis save — all structure. It takes `dexCap` and `saveBonus` as
arguments, and `NO_ACROBATICS` is what an unimported proficiency contributes:
nothing, rather than a guess. That is question 2 and question 3 living together
correctly in one file.

**This resolves a tension that was being re-litigated case by case, and it cuts
deeper than the first draft of this entry claimed.** That draft said any number
the code computes with may live in the function performing the rule, and used
the door helper as the example of something safely baked. Owner correction, same
day: **band edges and modifier values are content and need importing; what bakes
is the arithmetic of applying them and the conditions under which they apply.**

So the door helper's ±4 per point of Strength, +2 for a crowbar and ±8 per size
step are question 2, not question 3. So are the obstacle botch rows, the trap
rule's 1d6 per 10 feet, and the crude trap's +4/−2/+2. What stays baked is that
Strength moves the throw, that a crowbar helps, that a pair heaves with the
stronger adjustment, that spikes make it harder, that an unmodified low roll
botches — the shape of the throw, with the numbers handed to it.

That is a much larger program than the string pass, and it is why this is
written as a test rather than a list of sites. The thief ladders and the
Spelunking rows already left this way, and `jumping.mjs` was already built this
way. What made the difference was never how many numbers there were — it is
whether the thing is a rule being *performed* or a value being *read*.

**Enforcement** (SUPERSEDED 2026-09-03 — the citation signal is removed and the
page reference ships; questions 1 and 2 are both reviewer-only)**.**
`ip-scan.mjs` gains a citation signal: a book sigil next to a
page or chapter reference, inside shipped text (`lang/`, templates, pack
sources), is a hard failure. Code comments and `docs/` are exempt and stay
exempt — a comment citing RR p. 159 is attribution, and the comment doctrine
asks for it. This catches question 1 mechanically; question 2 still needs a
reviewer, which is why it is written down here.

**What it costs.** Moving an options table to the importer means the picker it
feeds offers nothing until the GM has imported from their own book. That is the
right failure — it is the same bargain the ladders made — but it means the
importer half must land FIRST, in a released tag (§10e), or a world upgrades
into an empty dropdown.

## 2026-08-15 — Lesson: build the replacement before retiring what it replaces

Recorded as a standing lesson for design work, not as a ruling to apply once.

The math-vs-words pass above stripped rules prose out of ~80 shipped strings in
one sweep, and did it BEFORE `acks-importer` had any way to supply the words it
removed. The doctrine says the book's sentences reach a world through the
importer; until that channel exists, "through the importer" means "not at all",
and a Judge upgrading gets a thinner hint with nothing on the other side of the
trade. The strings were the legacy implementation of an explanation, and they
were retired before the new one was ready.

Owner ruling: do not oscillate — the strip stands, the words come later. But the
sequencing was the wrong way round, and it is the same order this family already
writes down in two other places: TOOLCHAIN §10e (the dependency half lands
first, in a *released* tag) and the ruling on the masterwork table below (the
importer recipe first, or a world upgrades into an empty dropdown). Both were
about SYMBOLS and DATA. This is the same rule about PROSE, and nothing had said
so.

**The rule, generally: a replacement that does not exist yet is not a
replacement.** When a change removes something a user can see — a value, a
control, an explanation — the thing that supersedes it ships first, or the
removal waits. "It will come from the importer" is a plan, not a channel. Check
that the receiving end is released, not merely designed, before deleting the
sending end.

Applied to the work in flight: masterwork tiers, shield variants and silver are
NOT to be pulled out of `config.mjs` until `acks-importer` has released recipes
for them, however clearly the doctrine says they do not belong there.

## 2026-08-19 — The soak rules are removed; the recipe walk is the whole gate — IN FORCE

Supersedes the 24-hour soak and second-hotfix circuit breaker adopted
2026-08-18 (within the 7-day window, so the new evidence is named): **the
owner ruled the diagnosis wrong.** The hotfix clusters in the git history
were driven by agent decision-churn — implementation wobble, decisions
reversed mid-build — not by release cadence, and a time gate does not touch
that cause. What does touch it shipped alongside and STAYS: TESTING.md
recipes written during the build, the preflight gate walking the recipe for
every changed surface, and the DECISIONS reversal-evidence rule. A solo-dev
family that ships the moment its gates pass loses nothing to speed;
withholding a passing release only batches unrelated changes. REJECTED: any
release-cadence rule. TOOLCHAIN §4's "Soak rules" section is renamed
"Release discipline" and keeps only the non-cadence rules.

### A control byte in source is a rule that is dead and looks alive (2026-08-19)

**Ruled: `validate` fails on any C0 control character other than tab, newline
and carriage return, anywhere in `scripts/ tools/ templates/ styles/ lang/`.**

A tool writing a file through a shell-quoted string can land a real control
character where an escape was meant. `"\b"` inside a JavaScript string literal
is BACKSPACE, so a word-boundary regex written that way compiles to `/…\x08/`
and matches nothing, ever. The byte is invisible in the editor, invisible in
`git diff`, the file parses, the suite passes — and the rule it was guarding is
simply gone. It cost a full re-harvest of eleven books to notice, and only
because `file(1)` mentioned "overstriking".

This is a byte gate beside the BOM and cp1252 checks, and for the same reason:
these corruptions are all valid text to every reader except the one that
matters. Verified by probe — a file carrying one byte fails the gate by name and
line.

## 2026-08-20 — The preflight gate reads the working tree, not the commit log

**Ruled:** `release-preflight.mjs` computes changed surfaces with a
two-argument `git diff <lastTag>` plus untracked `scripts/` files, instead of
`git diff <lastTag>..HEAD`.

A release is prepared uncommitted — bump, changelog, snapshots, and the
feature itself all sit in the working tree while the gates run, and the commit
comes after. `..HEAD` sees none of that, so the recipe check reported "no
scripts/ surfaces changed since the last tag" and waived itself for exactly
the run it exists to check. Untracked files matter for the same reason a
diff alone is not enough: a brand-new feature directory is invisible to
`git diff` until someone adds it, and a new surface is precisely the case
where a missing TESTING.md must block.

Found during acks-extras v4.14.0, which passed the gate while carrying four
changed features and one entirely new one. The release was verified anyway —
by a live session scoped from the changelog rather than from the gate — which
is the failure mode worth naming: a silent waiver looks exactly like a pass.

## 2026-09-02 — A citation without a locator word is still a citation — SUPERSEDED (2026-09-03)

**Ruled:** `ip-scan.mjs`'s CITATION signal makes the locator word
(`p.` / `pp.` / `ch.` / `page`) optional and bounds the page number to three
digits. `LOCATOR_ONLY` is unchanged, so a string that is *nothing but* a
reference — the importer cookbook's ~1,250 `cite` fields — stays exempt.

The 2026-08-15 enforcement clause above described the signal as "a book sigil
next to a page or chapter reference", and the regex written from it required
one of those words to appear. Almost nobody writes citations that way. The
shipped form is `(RR 168)`, and the gate could not see it: `acks-extras`
carried 43 of them in `lang/en.json` — rule sentences, a printed weekly
distribution of the hiring pool, several modifier magnitudes, a level cap and
a wage rule, each with a page number attached — through every release up to
and including v6.2.0, while `ip-scan` reported clean on every one of them.

The failure is worth naming precisely, because it is not "the regex was too
narrow". Question 1 of the three-question test was the half that was supposed
to be *mechanical*, and its mechanism matched only the spelling a careful
author would use — the one an author who knew the rule would already have
avoided. A gate calibrated to the pedantic form of a mistake is a gate that
only catches people who were not making it. That is worse than no gate,
because §4's release procedure treats a clean `ip-scan` as evidence.

**Bounding the number is not cosmetic.** Without it, `MM` beside any quantity
in a monster string reads as a reference. Three digits covers the page range
of all three core books and leaves ordinary four-figure quantities alone.

Found while remediating the leaks the v6.2.0 pass had gone looking for and
missed. Two lessons landed elsewhere rather than here: printed magnitudes
reach a reader through *labels* as readily as through constants, and searching
for values the code READS does not find values the code only PRINTS.

## 2026-09-03 — The page reference ships; removing it protected nothing — IN FORCE

**Owner ruling.** The IP protection is *not to ship numbers and not to ship
prose*. A reference to the page is neither, and it **does** ship — in `lang/`,
in a template, in a pack source, in a comment, in `docs/`. `ip-scan.mjs`'s
CITATION signal and its `LOCATOR_ONLY` companion are removed; `ATTRIBUTION` is
narrowed from the book and publisher NAMES to a copyright notice. This
supersedes the enforcement clause of 2026-08-15 and the whole of 2026-09-02.

**Why a reference is not the thing being protected against.** Reproduction
substitutes for the book: a reader who has the sentence or the number does not
need the page. A citation does the opposite — it only pays out to someone
holding the book, so it can never be the substitution, and it sends people
toward the purchase rather than around it. It is also the module's audit
trail: it is what lets a Judge check the applied rule against the page, and
what lets a later session tell a structural constant from a printed one.

**The new evidence, which 2026-09-02 did not have.** That entry was one day
old and was written from the widened regex finding 43 strings. Applying the
rule to all 43 is what produced the evidence:

- **21** were paraphrases whose prose and printed magnitudes went out together
  with the citation. That is the rule working, and those stand.
- **22** were rule sentences that kept their text and lost only the pointer —
  "Domain rulers may hire henchmen of any level below their own", the
  Irrefusable Offer dialog, the animal-recruitment gate, the secret-roll note.
  The rule turned attributed derivative text into **unattributed** derivative
  text, on the exact axis the doctrine exists to defend.

The gate could not have told those two cases apart, because the signal it keyed
on — the citation — is the harmless half of both. A rule whose mechanism fires
on the correct behaviour will be satisfied by deleting the correct behaviour;
that is what happened, string by string, for 22 strings.

**Accepted cost: question 1 loses its mechanism entirely.** The three-question
test of 2026-08-15 put "is it a sentence about the rule?" first and treated the
citation signal as its mechanical half. It never was one — it detected a
*marker* that honest authors attach and careless ones omit, which is the
population inversion 2026-09-02 named and then failed to follow to its
conclusion. Question 1 now joins question 2: reviewer-only. `ip-scan` decides
paths and paste artifacts, and §4 must stop reading a clean run as a content
verdict. That is written into the scanner's own header so it cannot be
misread again.

**ATTRIBUTION narrowed.** It flagged `all rights reserved`, `adventurer
conqueror king` and `autarch`. The latter two are the plainest references
there are, and banning them contradicts the ruling; a lang string naming the
book a Judge needs is exactly right. What remains is the reservation-of-rights
line and a copyright notice naming the publisher — nobody types either to cite
a page, so in machine data they mean a page footer travelled in with the text
above it. Templates are now scanned for that signal instead of for citations,
comments included, since a paste is a paste wherever it landed.

**What did not change.** Numbers and prose. The deferred magnitude program is
untouched and still owed: ~125 `lang/` keys across the family carry a printed
figure in text a user reads, and `scripts/influence/constants.mjs`, the
henchman-cap arithmetic and the `item-loss-from-damage` threshold hold values
read off a page. Those are question 2, and question 2 was never about
citations.

## 2026-09-05 — Teardown is by the run's own ids; the prose that said so did not hold — IN FORCE

Several live-tester agents shared the one test world. One ended its walk with
a scratchpad cleanup that deleted every document whose name began with
`Plate ` — its own fixtures, as far as it knew — and took another agent's
party with them, dissolving that agent's formation mid-walk.
`live-testing.md`'s concurrency section already said to act only on your own
artifacts. The agent was not ignoring the rule; it was applying it with the
wrong notion of "own". A name is a description, and two runs describing their
fixtures the same way is the ordinary case, not a coincidence. CLAUDE.md's
ladder for a lesson that recurred despite being written down is a gate, with
the prose it replaces deleted.

**Ruled.** `bin/foundry-capture.mjs` carries a fixture ledger: `api.create()`
records the uuid of what it makes, `api.track(uuidOrId, kind)` records a
document made any other way, and `api.sweepTracked()` deletes exactly that
list — newest first, each re-resolved to prove it is gone — and returns what
it removed, what it could not find and what refused. Teardown keys on the
run's own uuids and on nothing else; a sweep by name, prefix, folder, type or
time window is forbidden. The live-tester agent and the live-testing rule now
state the mechanism where they stated the intention, and the sentence that
failed is gone from both. A run that dies before its sweep has its ids in its
log (every `track` prints), and re-tracking them is the recovery.

**Rejected — refusing name-keyed deletes inside `api.eval()`.** A regex over
the caller's expression would catch `startsWith("Plate ")` and miss the same
sweep written over a folder or a type: a gate calibrated to one spelling of
the mistake (2026-09-02, above). The gate is a sweep that cannot be written
wrongly, not a detector for the ones that can.

**Rejected — a file-backed ledger that survives a crashed run.** A second
store that can go stale, be shared by two runs, or name documents a later
session then deletes on trust. The log already carries the ids, and
re-tracking them is an explicit act by whoever reads it.

**Cost.** The ledger is mechanical only through the driver. A session that
creates fixtures in a browser pane keeps the list by hand; `pageSweep()` is
exported so the sweep it runs there is the driver's own code.

---

## 2026-09-07 — The window contract gates what a caption can reach, not only what a window can scroll — IN FORCE

Chrome's Issues panel, run against a live world, reported three classes the
family's checks had never looked for: a control inside a `<summary>`, a form
field with neither `id` nor `name`, and a `<label>` associated with nothing —
265 resources of the last one. Two of the three are decidable from a template's
own source, and one of them had already shipped as a live bug: `acks-extras`
carried 29 literal `id=` attributes across four item templates, so opening two
trap items made the second sheet's caption focus the FIRST sheet's field.

**Ruled.** `validate.mjs` §8 grows from three checks to six, and its charter
widens from "a window can be reached and read" to "and every control on it can
be reached from the keyboard, named, and told apart from its twin in a second
copy of the same window": interactive content inside a `<summary>` (an
href-less `<a>` diagnosed separately — it is not focusable at all), a `<label>`
no runtime pass could rescue, and a literal `id=` in a `.hbs`. Each takes an
escape comment on or just above its line, in the shape the existing checks
established. `.claude/rules/ui-layout.md` states the contract; the mechanics
stay in the file.

**Rejected — failing every `<label>` that carries no `for`.** That is the
CONFORMANT source shape in this family: the id must be unique per window, so
the binding is made after render (`acks-extras` `scripts/lib/a11y.mjs`) and a
template that wrote its own would be the defect. The check fails only a caption
the runtime pass provably cannot reach — no `for`, no wrapped control, and every
control before its parent's close already claimed by a label of its own.

**Rejected — matching a control inside a nested `<label>` as the boundary.**
Tried, and it produced two false positives on shipped templates within one run:
a caption followed by a checkbox row and THEN its own field is correct markup.
The first fix — ignoring any label below the top depth — silenced a real defect
in the same pass, which is the trade a gate must never make. The rule that
holds is the runtime pass's own: a control another label wraps is spoken for,
so its whole subtree is skipped, and the caption fails only when nothing
unclaimed is left.

**Cost.** The checks parse markup with a tag tokenizer rather than a DOM, so a
Handlebars branch that opens a tag in one arm and closes it in another leaves
an extent it cannot follow. Every one of those resolves to silence, which means
the gate under-reports by construction; it is a floor, not an audit.

## 2026-09-09 — The template's own tree was outside every gate it publishes — IN FORCE except its `tools/` copies and the step that compared them (superseded 2026-10-10)

**Problem.** `docs/LICENSING.md` describes two layers protecting the family
from committing licensed material: a pre-commit quarantine armed by `npm
install`, and CI as the backstop for an unarmed clone. Both sentences are true
of module repos and were false of this repo, which is where canon is authored
and from which every module syncs.

- The hook cannot arm itself here. `prepare` sets `core.hooksPath`, and this
  repo has no `package.json` — it generates one for module repos rather than
  carrying one — so `npm install` never runs and a fresh clone is ungated.
- CI never looked at this tree. `ci.yml` scaffolds a module from `skeleton/`
  and validates it in a SIBLING directory, so the `ip-scan` inside that
  `npm run validate` is structurally unable to see a file committed here. The
  scan that takes a repo private lives in `release-module.yml`, the reusable
  workflow module repos call; it scans the caller.
- `tools/` was outside everything. It is not synced from `skeleton/`, not
  compared to it by `sync-toolchain --check` (which audits module repos against
  `skeleton/`, and correctly reported zero drift while this diverged), and not
  syntax-checked by `ci.yml`. Its two files are the IP gate: `pre-commit` execs
  `ip-quarantine.mjs`, which imports `./ip-scan.mjs` by relative path. That copy
  had fallen behind canon and was missing the `ruledata/` path ban — the one
  ban added after a module shipped book tables as `ruledata/*.json` in every
  release zip from v0.1.0 to the 2026-07-19 audit.

**Ruling.** `ci.yml` gains two steps ahead of the scaffold: a scan of this tree
with `skeleton/tools/ip-scan.mjs`, and a `cmp` of every `tools/*.mjs` against
its `skeleton/` original. `tools/ip-scan.mjs` is refreshed to canon.
`LICENSING.md` states how this repo arms, instead of describing a mechanism it
does not have.

**Why the skeleton copy runs the scan.** Canon is what every other repo is
gated by, and reading it from `skeleton/` means the gate does not depend on the
very copy whose currency is in question. The `cmp` step keeps that copy
current; the scan does not wait on it.

**Rejected — a root `package.json` carrying only `prepare`.** It would close
the hook layer with the canonical mechanism. `manifest.mjs` GENERATES
`package.json` for module repos, so a root one is a file this repo's own
tooling has opinions about, and "nothing reads it" is an assumption rather than
a finding. The hole it would close is the one `LICENSING.md` already documents
and CI now genuinely backstops.

**Accepted cost: a fresh clone of this repo is still hook-ungated** until
someone runs `git config core.hooksPath .githooks`. CI catches what reaches a
branch; nothing catches what a local commit contains until it is pushed.

**Measure.** The `cmp` step fails if `tools/` and `skeleton/` diverge again,
which is the failure that produced this entry rather than any leak — nothing
was leaked, and the gate was found by checking a claim.

## 2026-09-23 — A template calls only helpers something registers — IN FORCE

**Problem.** During `acks-extras` 8.4.0, `templates/lib/hp.hbs` wrote
`{{selected cond}}` on its `<option>` tags. Foundry v14 registers `checked`,
`disabled`, `selectOptions` and their kin, and no `selected`. `npm run
validate` and `npm test` both passed; the window threw "Missing helper:
selected" on its first live render and never opened. (The tagged file carries
the `{{#if …}}selected{{/if}}` form — the broken shape was found live, which is
the point.) Section 2 precompiles every template, and precompiling resolves no
helper names: any name is legal until a render supplies the registry, and
nothing offline had the registry.

**Ruled.** `validate.mjs` §2b parses every template with the handlebars
package's own parser and fails a call — a block, or a mustache or
sub-expression given arguments, on a one-segment name that is neither a block
param nor an `@data` variable — to a helper that neither Foundry core nor the
module's `scripts/` registers. The core list was captured live from a server's
`/join` page, which holds core alone: on the same 14.367 server the in-world
registry held 59 helpers, being those 47, nine from the `acks` system (14.0.1)
and three from `acks-extras`. The list is recorded with its Foundry version and
recaptured when `compatibility.verified` rises (TOOLCHAIN §3, §5). Escape:
`{{!-- helper-ok: <reason> --}}`. The check prints what it covered.
`bin/test-validate.mjs` is the template's first test of its own validator —
seven invented modules, each case confirmed to fail when the behaviour it
guards is broken — and template CI runs it.

A block with no arguments is flagged as well, though Handlebars does not throw
on one: it runs the block as a section over the context property of that name
until anything registers a helper under the name, which then takes the block
over. Verified — `{{#rows}}` over `rows: [1, 2]` renders both rows, then
renders the helper's output once a `rows` helper exists. The family writes no
argument-less block today, so the rule costs nothing to adopt.

**Rejected — `knownHelpersOnly`.** Handlebars' own compile option nearly does
this in one line: pass the allow-list as `knownHelpers` and an unknown helper
throws at precompile. Verified against handlebars 4.7.9, it reports only the
first unknown in a template, it can carry no per-line escape, it misses the
argument-less block, and it treats every path given arguments as a registry
lookup, so `{{this.format x}}` — a function on the render context, legal at
runtime — fails as the unknown helper `format`.

**Rejected — rendering each template against mocks.** A mocked registry is
the author's own belief about Foundry, which is the thing that was wrong.

**Not listed — the game system's helpers.** They are a minified release's
internals, versioned apart from Foundry and published as no API. A call to one
is a dependency on that system build and says so at the call site, through the
escape. `acks-extras` calls none of the nine.

**Cost.** The list is one build's snapshot, so a helper a newer build drops
passes until someone recaptures. Registrations are read from source text, not
from execution: one in a file nothing imports, or behind a condition that
never holds, still counts. A call on a context path (`this.x y`, `a.b y`)
depends on the render context, which only a render has, so it is counted and
left alone.

**Found on landing.** `acks-extras` at HEAD: 4,247 calls to 21 distinct
helpers across 94 templates, every one registered.

## 2026-09-23 — The namespace check reads helpers through §2b's reader — IN FORCE

**Problem.** `validate.mjs` §7c checked helper names with a regex over each
`.mjs` file's raw text, and §2b, in the same file, read registrations with a
tokenizer. The two disagreed about what a registration is. §7c never saw
`registerHelper({ name: fn })` or a name held in a const, so an un-namespaced
helper registered that way passed; it read a registration inside a comment
or a string as live; and it skipped the `.js` files §2b reads.

**Ruled.** One scan of `scripts/` feeds both sections. §7c checks every name
the reader returns and prints how many. A `registerHelper` call the reader
cannot read fails §7c.

**Rejected — a WARN for the unreadable call, as §2b gives it.** §2b can
afford a WARN because it has a backstop: a template calling that helper still
fails as unknown. §7c has none. The name is the only thing it checks and no
other check reads it, so a WARN would pass an un-namespaced helper for good,
including one whose template calls carry `helper-ok`. The i18n pass set the
precedent (2026-08-04): a root it cannot resolve fails and is never skipped.

**Cost.** There is no escape. A name imported from another file, or a loop
over `Object.entries`, has to be rewritten as a same-file const or as
`registerHelper(object)`. Handlebars applies the object form as the loop
would (`extend(this.helpers, object)`, handlebars 4.7.9). The reader matches
any `registerHelper(` call, not only a `Handlebars.`-qualified one, so a
module calling a `registerHelper` method of its own would have those names
checked as helpers. Globals and hooks keep their raw-text regexes and those
regexes' gaps.

**Found on landing.** `acks-extras` at HEAD registers three helpers, all as
string literals, all namespaced, none unreadable. The old and new validators
return the same verdict there. The only new output is the coverage line.

## 2026-09-23 — The namespace check reads globals and hooks where they are written — IN FORCE

**Problem.** The previous entry moved §7c's helper names onto §2b's reader
and left globals and hooks on two regexes over each `.mjs` file's raw text:
`globalThis.X =` (or `??=`, `||=`), and `Hooks.call/callAll` with a quoted
first argument. They read a comment or a string as live code, never opened a
`.js` file, and saw one spelling each. The family does not name hooks that
way: a feature builds its hook names from a `NAMESPACE` const into an object
it publishes (TOOLCHAIN §5b) and fires them by member, often from another
file. In `acks-extras` the regex read 3 of 65 hook calls, and the comment on
the hook constants in `equipment/constants.mjs` called them "on the honour
system". The gap was known in the module and absent from the gate's output,
which is the failure 2026-08-04 rules out.

**Ruled.** Globals and hooks are read from §2b's tokens, in `.mjs` and `.js`
files alike. A global write is an assignment to a property of `globalThis`
itself, dotted or bracketed, under any assignment operator, or an
`Object.assign`, `Object.defineProperty`, `Object.defineProperties`,
`Reflect.set` or `Reflect.defineProperty` whose target is `globalThis`. A
write into an exposure (`globalThis.acksX.lib = …`) is not a new one. A hook
fire is `Hooks.call` or `Hooks.callAll`, optional chaining allowed. A name is
followed back through string and template literals, module-level consts,
object-literal members (`Object.freeze` included), named and namespace
imports, re-exports including `export *`, and both arms of a conditional. A
template whose hole does not read keeps its text up to that hole, and that
text still decides the name once it starts with the namespace or has left
it. Any call but `Object.freeze`, and any operator, ends the reading. A name
is followed only where the file binds it once, as a module-level `const` or
an import: a parameter or inner declaration of the same name can shadow it
where it is used. The check prints how many writes and calls it found, and
how many passed on the escape below.

**Ruled — a name the check cannot read fails, and only a hook call may say
why.** The previous entry's reason carries over whole: the name is all §7c
checks and nothing else reads it, so passing an unreadable name passes it for
good. A hook call takes `hook-ok: <reason>` on or just above it. The escape
answers only the unreadable verdict; a name the check does read on that line
is still judged. Global writes get no escape, and helpers keep none. This
departs from the previous entry, and the evidence it did not have is the
generic emitter. `acks-extras` has a function that fires whatever name its
caller passes (`announceChange(hook, …)`) and a transfer routine handed its
hook by four wrappers. Neither can be spelled so that this reads it, short of
deleting the abstraction. Every `registerHelper` call has the rewrites that
entry names, and every global write can be spelled `globalThis.<name> =`.

**Rejected — a WARN for an unreadable hook, as a foreign one gets.** The
foreign WARN is a verdict on a name the check read: it starts with another
module's key. An unreadable name has had no verdict to soften.

**Rejected — recognizing the runtime derivation.** Four `acks-extras`
constants files computed `NAMESPACE` as `MODULE_ID.replace(…)`, which leaves
every name built from it unreadable. The reader could special-case that
expression. It does not: the skeleton seeds `NAMESPACE` as a literal the
scaffolder renders, and a literal is compared with the id on every run, where
a recognized derivation would only be trusted.

**Rejected — following a parameter back to its callers.** It would read the
emitters. It needs every call of the function, through every import that
carries it, and the next wrapper defeats it again. `hook-ok` on the emitter
costs a line.

**Cost.** Reading stops at a class member, a `let` or `var`, an object
literal with a spread, a call and `+` concatenation. A name built any of
those ways fails as unreadable. `window.x =` and a classic script's top-level
`var` also expose globals and are not seen; the family writes neither. An
escaped emitter takes its callers' names out of the check: in `acks-extras`,
three `announceChange` calls and the four storage wrappers. The helper half
still follows same-file consts only, so a helper name imported from another
file fails as unreadable while a hook name imported the same way is read.
Closing that would revise a ruling made today and is left to an entry of its
own. The validator grows by about 460 lines, most of them the reader.

**Found on landing.** `acks-extras` at HEAD: 1 global write and 65 hook
calls read, where the regexes read 1 and 3. 39 calls fail as unreadable: 37
take their names from the four derived `NAMESPACE` consts, and 2 are the
emitters. Four literal `NAMESPACE` consts and two `hook-ok` lines clear all
39. They have to land with the sync, or `acks-extras`' validate goes red. 16
calls WARN because they fire `acksLib*` names, the `acks-lib` namespace from
before the merges. Renaming a hook changes what its listeners subscribe to,
so the rename is `acks-extras`' call.

## 2026-09-24 — The long-literal warning measures literals — IN FORCE

**Problem.** `ip-scan.mjs` warns on a string or template literal over 1,500
characters in `scripts/` or `tools/` source, so pasted prose gets a second
look. It found literals by pairing quote marks with one regex that knew
nothing of comments or regex literals, so a backtick in either opened a
"template" that ran to the next backtick anywhere in the file. The canonical
`validate.mjs` has backticks in both, and every module's `npm run validate`
printed warnings about the gate's own code: a 3,583- and a 2,002-character
span across comments and regexes in §8 at `b6ef157`, and at `d5d814a` a third,
1,728 characters, from a §6 regex to a comment below it. None was a literal. A
warning that fires on every run for nothing is one its readers learn to skip.
The pairing also missed real literals. A template with another nested in a
hole was cut at the inner backtick. A template after a regex holding a
backtick was paired away. A string continued across a line with `\` never
matched at all.

**Ruled.** Source is tokenized. Comments and regex literals are consumed
whole. A template is followed through its `${}` holes and the braces and
literals nested in them. Whether a `/` opens a regex is decided from the token
before it, and one that meets a line end before its closing `/` was division.
A literal's length is its own text, delimiters included: a template's holes
are code, and a literal nested in one is measured on its own. The warning
names the literal's line. The tokenizer can lose its place: a quoted string
meets a line end, a bracket closes the wrong opener, or something is still
open at the end of the file. Then the file is measured by the old pairing and
a warning says so, which over-reports a file the tokenizer cannot read and
never skips it. The path bans, the LOCAL-ONLY extract names, the copyright
notices and the data-file leaves are untouched. `bin/test-ip-scan.mjs` feeds
the scanner invented sources, each case confirmed to fail when the behaviour
it guards is broken, and template CI runs it.

**Rejected — reusing `validate.mjs`'s `tokenizeJs`.** It lives in a file with
no exports, whose top level runs the whole validation and imports
`handlebars`. `ip-quarantine.mjs` loads the scanner by relative path in the
pre-commit hook, on a clone that may never have run `npm install`. Moving the
tokenizer to a shared file would add an import on that path and a COPY entry
the hook fails without whenever a sync lands partially. So the tokenizer is
inline and imports nothing. It is not a copy either: `tokenizeJs` reads
`i++ / 2` as an unterminated regex that swallows the first word of the next
line, and reads `if (ok) /'/.test(s)` as a division followed by a string.

**Rejected — measuring a template backtick to backtick.** That is what the
pairing measured whenever it paired correctly, and it counts the code in a
template's holes as literal text. The character-generation chat card in
`acks-extras` (`scripts/classes/chargen.mjs`) is a template spanning 1,824
characters: seven holes and 14 characters of `<p>` tags. Measured by span, it
becomes a new warning about authored code, which is the lesson `validate.mjs`
was teaching. The measure chosen has a blind spot of its own. Prose split
between literals in one template's holes (`${a ? "…" : "…"}`) is measured
literal by literal, where the span summed it. Concatenation (`"…" + "…"`) has
the same blind spot, and neither measure ever caught it.

**Cost.** The scanner grows from 233 lines to 404, in a file every module
carries. Two readings are heuristic. After a block's closing `}` a `/` is read
as division, so a statement that opens with a regex straight after a block
sends its file to the fallback. A `)` admits a regex only after `if`, `while`,
`for` and `with`. The tokenizer was checked against acorn 8.16 on 7,645
files: 1,984 sources from eleven local repositories and 5,661 from four
`node_modules` trees, minified bundles among them. It lists the same 756,417
literals at the same offsets and lengths, and it loses its place in none of
them.

**Found on landing.** `acks-extras` at `0cc2032` goes from 12 warnings to 7,
none new. Gone as non-literals: `tools/validate.mjs`'s three, and a
1,859-character span in `tools/validate-producers.mjs` from a doc comment
into a template 48 lines below. Gone as measured: `tools/bridge-walk.mjs:274`,
a live-test teardown script in a template spanning 1,796 characters, 350 of
them in twelve `${JSON.stringify(…)}` holes, which leaves 1,446 of text.
Kept: seven hole-free templates of authored code. Five are macro bodies in
`tools/pack-data/equipment.mjs`, one is in `tools/pack-data/cleanup.mjs`, and
one is a SQL schema in `tools/importer/build-chefdb.mjs`. They are the
source-side twins of the macro `command` bodies `CODE_KEYS` exempts in data
files. Whether source gets the same exemption is left open.

## 2026-09-24 — `tokenizeJs` tells a regex from a division by the scanner's rules — IN FORCE

**Problem.** One tokenizer, `validate.mjs`'s `tokenizeJs`, feeds both §2b's
registration reader and §7c's global and hook reader. It decided whether a
`/` opens a regex from the token before it, and in places decided wrong. It
read a regex after `x++`, after `x--` and after a property spelled like a
keyword (`counts.new / total`). It read division after every `)` and at the
start of a template hole, so `if (ok) /'/.test(s)` and `${/'/.test(s)}` were
a division and then a string. A regex that met a line end stepped past it
and took the next line's first word as its flags. For each of these an
invented module shows a verdict changing. A misread regex hid the rest of its
line from both checks, and the first word of a next line written at column
0. A hook call or `globalThis` write there went unchecked, so the module
passed. A `const` there was lost, so a correct hook named through it failed
as unreadable. A misread division let a quote inside the regex open a string
to the line end, hiding a hook call beside it. Inside a template hole that
string also took the hole's `}` and the closing backtick. The next block's
`}` then closed the hole, the code up to the next backtick read as template
text, and the template after it read as code. A `registerHelper("…")` quoted
in a usage string became a registration, and a template calling that helper
passed §2b.

**Ruled.** A `/` opens a regex at the start of the source or of a hole, after
punctuation other than `)`, `]`, `}`, `x++` and `x--`, after a word in
`REGEX_AFTER_WORD` that is not a property name, and after the `)` closing an
`if`, `while`, `for` or `with` head. Everywhere else it divides. A `/` read as
opening a regex that meets a line end before its closing `/` divides instead,
so a misjudged one stays on its line. These are the rules of `ip-scan.mjs`'s
tokenizer (the entry above), applied to the tokens the readers already take.
`bin/test-validate.mjs` gains five invented modules. Each one fails against
the old tokenizer, and each fails when the one rule it guards is removed.

**Rejected — one tokenizer for both files.** The entry above rejected that for
a structural reason, and the reason still holds. Its second reason no longer
does. It said `tokenizeJs` misread `i++ / 2` and `if (ok) /'/.test(s)`, and
now `tokenizeJs` reads both as the scanner does. The two agree on where a
regex starts and differ only in what they emit.

**Rejected — a parser.** acorn decides every `/` the way the engine does, but
no module repo installs it. Making it a canonical devDependency (TOOLCHAIN §5)
would change every module's toolchain, which is more than a fix to a reader.

**Cost.** One heuristic remains, the one the scanner also has. After a block's
`}` a `/` divides, so a statement that opens with a regex straight after a
block is misread. The scanner notices when that loses its place and falls back
to pairing quote marks. `tokenizeJs` cannot notice. A quote in such a regex
can hide the rest of its line, and a backtick everything up to the next
backtick. A variable spelled like one of `REGEX_AFTER_WORD` (`const of = 4`)
still reads as opening a regex, and the line-end rule turns it back into
division only when no second `/` follows on that line. The check against
acorn 8.16 covered 7,688 files: 2,027 local sources and 5,661 in four
`node_modules` trees. The tokenizer puts identifiers, strings, template pieces
and regexes at acorn's offsets in 7,671 of them, up from 7,665. The other 17
show two misreads this entry leaves alone. In 15, all pdf.js builds, a
member of a decimal literal is read into the number (`1.0.toString`). In the
2 others, from prettier, an identifier is written with `\u` escapes. Neither
shape holds a name either check reads: a number's member is a Number method,
and no family source spells an identifier with an escape. The validator grows
by 34 lines.

**Found on landing.** At `4d9ca3b`, the old and new tokenizers turn every one
of the 446 files in `acks-extras`' `scripts/` into the same tokens. Both
checks therefore return the verdicts they did. The one family file that hit a
fixed misjudgment is `tools/importer/dev-probe-rebuking.mjs`: a regex opens a
template hole there, and neither check reads `tools/`.

## 2026-10-01 — The capture driver keeps its page in front and its tray out of frame — IN FORCE

**Problem.** Shooting `acks-extras` 9.6.0's snapshots, the driver failed three
ways. A toast landed between `compose()` and the capture and sat over the
subject: on a GM seat the importer opens its book library in the background,
so its toasts arrive seconds after any sweep, and they name the Judge's books.
After a few minutes the page stopped answering, a `Page.captureScreenshot` in
one run and the evaluation awaiting a window's `close()` in another. Each
unanswered call cost the full 90 seconds a DevTools call was allowed.

The stall was reproduced on a fresh profile with the driver's own launch flags
(Edge 154, headless). Within ten seconds of launch the browser lists a sync
confirmation dialog as a page at its own address; it has no window and hides
nothing. Between 51 and 58 seconds in, an extension opens its first-run page
as a tab in the driver's window, in front of the driver's page. From then that
page is hidden. It runs no animation frames, a 100 ms timer chain ticks once a
second, and nine minutes in a 2-second timer had not fired after eight. A loop
closing twelve windows the way `ApplicationV2#close` does, each close waiting
for a transition or for one second, took 24 seconds hidden and 2.4 visible. Of
seven screenshots of the hidden page, five answered in anything from 49 ms to
7 seconds and two did not answer in the 15 and 30 seconds they were given.
Neither page appears under `--disable-sync`, and under `--disable-extensions`
only the dialog does. The cause is therefore read as the fresh profile signing
in with the OS account and syncing an extension; the sign-in itself was not
observed.

**Ruled.** `connect()` launches with `--disable-sync`, and `pageKeeper` holds
the rest. `front()` closes every page target that is neither the driver's own
nor at a document's address, each one once, activates the driver's page with
`Page.bringToFront`, and warns when it found the page hidden, saying whether
fronting showed it. `compose()` and `shot()` call it before anything else.
`compose()` then closes each application with `close({animate: false})`. An
animated close waits for a transition, or for a second where its element has
none, and the 21 applications open on a page that has just joined have none:
that loop took 23.8 seconds animated and 9 ms unanimated, for the same 21
closed and the same page left. `capture()` takes the frame: it hides the
notification tray with one stylesheet and removes that sheet in a `finally`,
leaves the tray showing when the shot's subject is inside it, and before each
attempt fronts the page and waits for two animation frames. A screenshot is
given 30 seconds, then one more attempt; a second failure throws, naming both
and whether frames were arriving. `Cdp.send` takes a timeout per call and
clears its timer when the reply comes. `bin/test-foundry-capture.mjs` drives
the keeper against a scripted page that runs the driver's own page-side
expressions, each case confirmed to fail when the behaviour it guards is
broken, and template CI runs it.

**Rejected — closing only pages at `edge://`.** That is the fix as it was
first used, beside the launch flag and `Page.bringToFront`. The page it closes
is the dialog, which was never in front of anything and stays listed after
`Target.closeTarget` reports success. The page that took the foreground has an
extension's address. Fronting alone showed the hidden page at once, frames and
all, with that tab still open, and closing that tab alone did the same; the
three clean runs are owed to the flag and the fronting. The rule is written by
what a stray page is not, the driver's own or a document, so the next page a
browser opens for itself needs no new spelling.

**Rejected — `--disable-extensions`.** It kept the page visible for the four
minutes it was watched, with the dialog still listed. It removes one cause of
a hidden page that the sync flag already removes, and fronting answers the
condition whatever caused it.

**Rejected — fronting before every `api.eval`.** A walk makes hundreds of
evaluations, and fronting is three round trips and a fourth for each stray.
What stalls on a hidden page is a wait on a frame, a transition or a timer.
The driver's own is the frame `shot()` takes, which is fronted, and
`compose()` no longer makes one.

**Cost.** No frame shows a toast unless the shot's subject is the toast. A
capture that never answers is given up after two attempts of 30 seconds, each
behind a frame wait of up to four, where it was given up after one of 90. A
walk's own `api.eval` is not fronted, so a wait it makes on a page hidden since
the last `compose()` or `shot()` is as slow as before. `Cdp`, `pageKeeper` and
`strayPages` are exported for the test, on a file other scripts import. The
scripted page pins the order of the driver's calls and nothing a browser does.
One mutation survives it, the half of the tray's rule that reaches the tray's
descendants, which only a live page evaluates. The unanimated close was not
among the fixes a release run had proven: it was measured here on a
player-role and a GM-role seat, and an application whose own `close()` drops
its options still animates. The first `compose()` of a run used to hold the
walk for about 24 seconds after `ready` and now returns in under two. A walk
that leaned on that wait has to wait on a signal of its own: in these runs
the importer was still raising toasts 20 seconds after `ready`.

**Found on landing.** One script was run against the test world through the
driver at `6fd5dec` and through this one, on a non-GM seat, creating no world
document. The old driver's page was hidden 75 seconds after launch, with the
dialog and the extension's tab both listed; the new one's was visible, with
neither. A toast raised before the shot was in the old driver's frame of a box
clipped over the tray and absent from the new one's, and present in the new
one's frame when the tray itself was the subject. The first `compose()` of a
run, 21 applications on a visible page, took 23.6 seconds through the old
driver and 1.6 through the new. With a tab opened over the page, `compose()`
closed four dialogs in 12.7 seconds and in 0.07, and the new driver warned
that it had found the page hidden. With a page at the browser's own address
opened over it, `shot()` took 3.7 seconds and 0.2; the new driver closed that
page first and said so. On a GM-role seat that was not the active GM, the new
driver's `compose()` closed that seat's 21 applications in 20 ms and the frame
shot after it was clean. A script that called `close()` exited 85.6 seconds
later through the old driver, its calls' timers still running, and at once
through the new.

## 2026-10-01 — A DOM node is not told by `instanceof` — IN FORCE

**Problem.** Core 14 hosts an application in a browser window of its own
(`detachWindow`), and builds a window's frame with the document of the browser
window that hosts it. A window first rendered inside a detached one, which
`renderChild` and a `windowId` option do, has a root that window's document
built. In the main window `root instanceof HTMLElement` is false for it, for
every node reached through it and for the target of every event inside it.
`acks-extras` resolved a render hook's root with
`element instanceof HTMLElement ? element : element?.[0]` in 37 places. For
such a window the second arm ran, which is nothing for most roots and a form's
first control for a `<form>`, since a form indexes its controls. The hooks
passed the window by or worked on one of its controls, a listener guarded by
`instanceof HTMLInputElement` dropped every event, and nothing reported any of
it. `validate` and the suites stayed green: every stand-in a suite hands a
hook is made in the one realm the suite runs in. The measurements are
`acks-extras`' own (`docs/lib/DECISIONS.md`, "An element is told by its
`nodeType`, never by its constructor").

**Ruled.** `validate.mjs` §8 grows from six checks to seven. 8g fails an
`instanceof` whose right-hand side names a DOM node interface, written bare or
off `window`, `globalThis` or `self`, in a `.mjs` or `.js` under `scripts/`:
`Node`, `Element`, `CharacterData`, `Text`, `Comment`, `DocumentFragment`,
`ShadowRoot`, `MathMLElement`, and every `HTML…Element` and `SVG…Element`. It
reads `tokenizeJs`'s tokens, so a test written in a comment, a string or a
template's text is not one. A file that binds the bare name itself is testing
a class of its own and is passed by. The escape is `// realm-ok: <reason>` on
the test's line, or in a comment of its own on the line above. The check
prints how many `instanceof` tests it read and how many passed on the escape.
`.claude/rules/ui-layout.md` states the rule, and `bin/test-validate.mjs` gains
three invented modules.

**Rejected — a module-owned check**, the same test in `acks-extras`'
`tools/validate-extra.mjs`. It needs no template commit and no push before a
sync. The rule would then be no part of canon, and a module scaffolded from
this template would not inherit it.

**Rejected — no gate**, the sweep and a roadmap row. The expression reached
37 places with nothing to stop it, and a row stops nothing.

**Rejected — the node's own window as the remedy**,
`node instanceof node.ownerDocument.defaultView.HTMLElement`. Which window's
constructor claims a node does not follow the document the node sits in. A
root first rendered detached and then brought back by `attachWindow()` sits in
the main document and is still no instance of the main window's `HTMLElement`
(measured, same entry). The failure message names `nodeType` and `matches`.
The check does not fail that spelling, since it reads only a bare or
window-global name.

**Rejected — every platform class.** An event, a `DOMRect` or a `File` made
in another window has that window's constructor too. No family source tests
one with `instanceof`, and the words are ones a module names its own things
with: `Document` is core's document base class, and `Event`, `Range` and
`File` are ordinary class names. The list is the node interfaces, which is
the failure that was measured.

**Cost.** The check reads what is written, never what a name is bound to
where it is used. A name the file binds anywhere passes every test of that
name in the file, so a parameter called `Text` in one function hides a DOM
`Text` test in another. A node class reached another way is not seen: held in
a const, compared through `constructor`, or tested in a file outside
`scripts/`. A comment trailing the code on the line above excuses nothing,
where 8c to 8f take any text on that line. It is a floor, like the rest of §8.

**Found on landing.** Against `acks-extras` at `c2cc033`, before its sweep,
the check reads 64 `instanceof` tests and fails 40 of them, on 39 lines in 35
files: 37 against `HTMLElement`, two against `HTMLInputElement` and one against
`HTMLSelectElement`. At `85d2c6a`, the sweep, and at `85a5d21`, the 10.0.0
release this change was held for, it reads 24 and fails none. Those 24 test
documents, placeables, `Set`s and `Map`s, one core operator and the module's
own classes. A module scaffolded from the skeleton passes with none read.
`acks-divine-conduit`, which this template does not sync, holds one copy of
the expression (`scripts/module.mjs`).

## 2026-10-07 — A commit on a shared tree is one session's hunks, gated as the tree it commits — IN FORCE

**Problem.** Several sessions write in one `acks-extras` working tree at once,
on `main`. TOOLCHAIN §4 said to gate what is staged and not what is on disk,
as one paragraph of prose, and each session carried it out with a script of
its own, adapted from the last session's and kept in scratch space. What those
runs met, between 2026-09-20 and 2026-10-07:

- On three occasions (the 9.5.0 and 9.6.0 releases and a sweep on
  2026-10-01) a peer's hunk arrived in a file the session counted as its own,
  after the gate or within the hour before the commit. A whole-file `git add`
  would have committed each ungated. Rebuilding the tree and comparing its id
  with the gated one caught the second, and a per-hunk predicate the third.
- A list built by exclusion, everything but the foreign paths, sees a foreign
  file left out and is blind to one taken in. At 10.1.0 two of a peer's docs
  files rode into a gated tree and the check printed clean. The count of
  modified files caught it, after the peer had committed.
- An export of a tree has no git history. A check that reads history prints a
  note there and exits 0, so an export gate says nothing about it.
- A peer published the version a session was drafting a changelog section for
  (8.0.1), and the release preflight caught it only at the bump.
- On 2026-10-06 several sessions were told to commit within one half hour.
  A full gate ran about nine minutes, each was invalidated by another
  session's commit, and three sessions committed on a moved base on their own
  call.

**Ruled.** The rule is `.claude/rules/shared-tree.md`, synced to every repo.
Its mechanics are one tool, `.claude/skills/acks-commit/commit-own-hunks.mjs`,
which builds a change in a private index, gates that tree in a clone, and
stages on the shared index only when the tree id is the gated one.
`bin/test-commit-own-hunks.mjs` runs it in this repo's CI. TOOLCHAIN §4's
paragraph is a pointer to the rule. A release commits through the same tool,
tags its own commit's sha and pushes that sha with the tag atomically.

**Ruled by the owner, 2026-10-06 — a moved base may be carried.** Asked to
choose between carrying a green gate over a base that moved and always running
the full gate again, the owner chose to carry. The conditions put to them and
accepted: the commits that landed write none of the change's files and no gate
tooling, the tests pass again on the exact rebuilt tree, and the full gate
then runs on the commit itself. The question was about sessions committing
from the shared `acks-extras` tree. The rule file states it for every shared
tree in the family, which is this entry's reading and not the owner's words. A
release is outside it.

**Rejected — always gate again.** With several sessions committing, a gate is
as long as the window in which another commit lands, so the loop need not end.

**Rejected — a check inside `validate`.** A gate cannot see how the commit
that will carry its result is going to be staged.

**Ruled by the owner, 2026-10-07 — TOOLCHAIN §2 stands.** Asked whether the
default should become "commit, and leave it unpushed unless told", the owner
kept "push what you commit". A session told to commit and hold a release
leaves its commit unpushed on that word, each time.

**Not decided here.** A worktree or a branch per session, with one session
landing commits, would remove the shared index and most of this entry. The
family is single-branch with no worktrees, enforced by
`.claude/hooks/single-branch-guard.mjs`. The owner asked for an assessment on
2026-10-07 and is not keen: there is one live environment, so work may as well
merge as it is developed, though it might avoid rework.

**Cost.** The clone holds committed files only, so a gitignored suite does not
run in the gate. A carried commit is on `main` before the full gate has run on
it, for as long as `postgate` takes. The hunk pattern is the session's claim:
one that matches a peer's hunk takes it, and the `record` listing is where
that shows, if it is read. "A new check that reads your files is gate tooling"
is the session's judgement; the tool's pattern knows paths, not what a landed
check reads. A release gates twice, once in the working tree before the live
walk and once on the release tree at the commit.

**Found on landing.** `bin/test-commit-own-hunks.mjs` holds 18 cases over
throwaway repositories whose gate fails on a peer's line, so a gate that read
the working tree in place of the built tree is red. Each of 22 single edits to
a copy of the tool removes one guard, and the suite fails 18 of them. The four
it passes: the staged tree compared with the gated one and the commit read
back after it is made, both of which fire only when a second writer lands
between two of the tool's own steps; the changed-path list compared with
`change.json`, which the earlier refusals leave unreachable; and removing the
clone's links before deleting it, which Node 22 on Windows does not need,
since its recursive delete removes a junction without following it. The first
such run passed 7 of 20 edits. One case had exited 2 for a reason other than
the one it named, and the hunk count and the carry stages had no case. On this
repo's own tree, with a peer's uncommitted `skeleton/.claude/settings.json` in
it, `record` split TOOLCHAIN.md's five hunks between three changes. Before the
commit that carries this entry, `gate` and `commit` had run on fixtures only.

## 2026-10-07 — A worktree or a branch per session is rejected, and what is left lands as tools — IN FORCE

**Problem.** The entry above left open whether each session should work in a
worktree or on a branch of its own, with one session landing commits. The
owner asked for an assessment, and wanted two things from it that pull apart:
less rework between sessions, and work that merges as it is developed, since
there is one live environment.

**Found.** The `architect` agent sorted the rework by cause and asked of each
whether an isolated tree removes it.

| Cause | Seen as | Removed by an isolated tree |
| --- | --- | --- |
| One index and one tree | A peer's hunk in a session's file, a peer's file taken in by an exclusion list, a gate red on a peer's in-flight hunk (the entry above) | Yes, and `acks-commit` removes it too |
| A gate as long as the gap between commits | Seven commits to `acks-extras` between 22:01 and 23:00 on 2026-10-06, against a gate of five to nine minutes | No. A branch still lands on a `main` that moved |
| One test world | A wait for a seat, a shutdown that drops a peer's client, a launch refused while peers are live | No, and it adds a cost: the dev install is a junction to the main tree, so a worktree's code is live only once it has landed |
| A version number a peer took | 8.0.1 | No |

Two of the gates lost on 2026-10-06 were already running in clones of their
own, so the tree they read was isolated and they were lost all the same.

**Ruled by the owner, 2026-10-07.** Rejected. Sessions keep one working tree
and one branch.

**Rejected — a worktree or a branch per session.** It removes the one cause
the commit tool already removes, leaves the cause of that night's rework
standing, and puts a landing between an edit and the live world. It would
also undo the single-branch guard this file promoted to canon on 2026-08-05
(TOOLCHAIN §7), and bring back the stranded branch as something a session can
leave behind.

**Rejected — a trial for sessions that walk nothing live.** Offered beside
the above and not taken.

**Ruled by the owner, 2026-10-07 — what is left lands as tools.** Shown the
assessment's other proposals, the owner answered that what is needed is a
tool in the harness and not a work instruction, and chose this order:

1. A hook that refuses a hand-run `git add` or `git commit`, and the commands
   that discard a path's changes, so the commit tool is the one way to commit.
2. A ledger written by a hook as each session edits, from which the commit
   tool reads whose lines are whose.
3. A lease, so one gate-to-commit runs at a time.
4. The gate's serial work run side by side, with the same checks.

The prose each one replaces is deleted as it lands. The entry above shipped
one tool beside several pages a session has to read, and a rule that is only
written down is the kind this family has seen recur.

**Not decided here.** A lease on the test world, and where a release's live
walk runs. Landing several queued changes under one gate waits for gate logs
that show a queue.

**Cost.** Until the ledger lands, whose hunk is whose stays a claim, made by
a pattern the session writes and a listing it reads, and a pattern that
matches a peer's hunk commits it under a green gate. An isolated tree cannot
do that. A commit that lands under a gate still costs that gate or a carry
until the lease and the shorter gate land. A hook binds only the sessions
started after it is synced.

## 2026-10-07 — A retired update key fails where it is written and passes where it is read — IN FORCE

**Problem.** Foundry 14 retires two spellings of an update key,
`{"-=key": null}` and `{"==key": value}`. It tells one by its first two
characters (`foundry.utils.isDeletionKey`, read in the 14.367 install),
migrates it wherever it merges, diffs or cleans data, and logs a compatibility
warning for every such key of every write. `acks-extras` ruled on 2026-09-11
that every forced deletion it writes is the operator, through lib's `unset()`
(its `docs/lib/DECISIONS.md`, "A deletion is the operator, spelled once"), and
swept `scripts/` in the same release. Two later releases added four legacy
writes to `scripts/`, 8.7.0 one and 9.2.0 three, and two shipped macros had
carried one each since `v0.1.0`, where the sweep did not look: a macro's
command is text inside `tools/pack-data/`. Nothing failed on any of the six.
Three of the four and both macros were found by hand on 2026-10-07; the fourth
had gone in 10.2.0, and the backtest below is what shows it was there. This
template recommended the retired spelling itself, in the hygiene-sweep prompt
and in TOOLCHAIN §10h.

**Ruled.** `validate.mjs` gains §9, and the IP scan and the module's extra
validator become §10 and §11. It reads `tokenizeJs`'s tokens of every `.mjs`
and `.js` under `scripts/` and of the `command` of every script macro under
`packs/_source`, so a key in a comment is not one. A string or template
literal spells a legacy key where it holds `-=` or `==` after a dot, or at its
own start with no `+` joining it to what came before, followed by a name or by
a `${}` hole or a `+` that supplies one. Where the literal stands gives one of
three verdicts. **Written**: a property name of an object literal, quoted or
computed, the key of a member assignment, the key of a `[key, null]` entry,
the path handed to `setProperty`. **Read**: the left operand of `in`, an
operand of a comparison, a `case` label, the key of a member looked up, a
property a destructuring pattern takes, an argument of `hasProperty` and its
kind. **Neither**: bound to a name, returned, an array element, an argument of
any other call. Written and neither fail, and a read passes. The escape is `// legacy-key-ok: <reason>` on the line, or in a
comment of its own on the line above; in a macro that is a line of its
command. A declared Macro pack with no directory under `packs/_source` fails
as unread. The check prints how many spellings it read, in how many scripts
and macro commands, and how many fell to each verdict and to the escape. The
hygiene-sweep prompt and TOOLCHAIN §10h name the operator, and
`bin/test-validate.mjs` gains six invented modules.

**Rejected — a module-owned check**, the same test in `acks-extras`'
`tools/validate-extra.mjs`. The rule would be no part of canon, and a module
scaffolded from this template would not inherit it.

**Rejected — failing every spelling, with a comment on each reader.** A hook
tests a diff for the legacy key for as long as another package may still send
it, so the readers are the half that stays. `acks-extras` has three such
files. What each does with the key is written beside it, as `in` or
`hasProperty`, and an escape that restates what the source already says is
one a reviewer learns to skip.

**Rejected — passing a spelling nothing decides.** A key bound to a name is
written or tested somewhere this does not follow. Passed, the two-step write
`const key = "-=" + name; update[key] = null` is green. It fails, and the
message says that nothing written decides it.

**Rejected — reading a macro's command where it is authored.** In
`tools/pack-data/` a command is an inline template in one file, a string with
`\n` escapes in another, a module-level const, a helper's argument and a
remap of `m.command`. A reader of that source guesses which literals are
commands and cooks their escapes before it can tokenize one. `packs/_source`
is what `build:packs` writes from all of them, and what ships.

**Cost.** A macro is read as `build:packs` last wrote it. Every gate builds
before it validates, so a gate reads the current command; `npm run validate`
alone, after an edit to pack data, reads the old one. The check reads what is
written beside the literal and follows no name: an operator that arrives
through a `${}` hole or a `+` with no dot written before it in the same
literal is not seen (`${path}-=${key}`), nor is a key joined any other way, or
source outside `scripts/` that is no macro command. A reader the check cannot
follow costs its author the escape: one that holds its keys in an array, one
that compares against the right-hand end of a `+` chain, a destructuring
pattern in a parameter list.

**Found on landing.** Against `acks-extras` at `3088cf4`, release 10.2.1, the
check reads six spellings in 505 scripts and 33 macro commands: two written,
one in each of the macros "Clean Up After the Merge (GM)" and "Configure
Proficiencies", and four read, in the three files that test a diff for one.
`acks-extras` takes this validator with those two macros converted, or its
`validate` is red. Across its 183 tags no spelling falls to neither. It reads
29 written at `v7.5.3` and two at `v7.5.4`, the sweep; three at `v8.7.0`, six
at `v9.2.0`, five at `v10.2.0` and two at `v10.2.1`. The ten archived repos it
was merged from, as archived: six written in `acks-equipment`, one in
`acks-lib`, one in `foundryvtt-acks-importer`, none spelled in the other
seven. A module scaffolded from the skeleton passes with none read.
`foundryvtt-acks-core`, which this template does not sync, spells one in
`src/` that falls to neither: a `-=` segment built for Foundry 13 behind a
test for the operator.

## 2026-10-07 — A release push the remote rejects is repeated whole, inside a bound — IN FORCE

**Problem.** `acks-release` step 7 covered GitHub failing after the push: the
tag is on origin, the release finishes on its own, and the session reports
and stops. Step 6 said nothing about the push itself being rejected. Nothing
is on origin then, and a session that stops leaves a release commit and a tag
in a tree other sessions share.

**Found.** Releasing `foundryvtt-acks-extras` v10.2.1, the atomic push that
this date's shared-tree entry ruled was rejected seven times between 11:08
and 11:15 local time, each with `remote: Internal Server Error` and
`! [remote rejected] … (Internal Server Error)` on both refs. The eighth
attempt, at 11:16, was accepted unchanged. Each attempt read the remote
first, and before all eight its `main` was where it had been and the tag was
absent. The session's retry was six attempts 75 seconds apart, and the sixth
was the one accepted, about eight and a half minutes after the first
rejection. Those counts are from its output files, one per attempt. As the
owner relayed it, githubstatus.com showed no incident and `gh api` answered
throughout, and before the session settled on a retry it ran
`git fsck --strict` on the commit and looked at the repository's rulesets, at
a release or tag of that name and at the API's health. None of it found
anything.

**Ruled.** The handling is three cases under `acks-release` step 6, stated
there and nowhere else: a push rejected with a server error is repeated alone
and whole inside a bound, the session stops at the bound with the command
that completes the release, and the tag goes alone where a peer's push
carried the release commit to origin first. TOOLCHAIN §4 step 6 points at
the skill. The owner was shown the text and the alternatives below on
2026-10-07 and took it as proposed.

**Rejected — the branch pushed first and the tag after it.** A remote that is
failing writes is where one can land without the other, and the atomic push
exists so that a release commit never reaches origin without its tag by the
release's own hand.

**Rejected — the rule's sentence in TOOLCHAIN as well.** A releasing session
works from the skill, which is what syncs into a module repo. A copy in
TOOLCHAIN would be a second place to tune the bound and the commands, and the
first to drift. A pointer names the place.

**Rejected — a script for the retry alone.** It would run only while a remote
is failing. No release exercises that path and no test can drive it against
the real remote, so the script would be least proven where it is needed.

**Not decided here.** Whether step 6's tag and push become a tool beside the
skill, as the commit is, with these three cases inside it and the bullets
deleted as it lands. This date's tools entry orders four tools and this is
not among them. For it: the session on the day wrote the step as two scratch
scripts, which is where the shared-tree entry's problem started. Against it:
the failure has happened once and had never been written down, which is short
of "recurred despite being written down" (`skeleton/CLAUDE.md`, "Where a
lesson lands"). The owner was shown both on 2026-10-07 and left it undecided.

**Cost.** The bound, about fifteen minutes, is set from one outage of about
eight and a half. A session that reaches it leaves a release commit and its
tag local, and the next peer to commit above them and push carries the commit
to origin without the tag. Telling a server error from any other refusal is
the session's reading of git's output. The stop on a later version rests on
documentation and has not been tried: GitHub marks a newly published release
latest unless told otherwise, `softprops/action-gh-release` passes that
default through, and the Release workflow sets nothing.

**Found on landing.** On throwaway repositories, with git 2.50.1: a remote
that rejected the atomic push moved neither ref; step 6's line run a second
time stopped at `git tag` and pushed nothing; the push alone then landed both
refs; with a peer's commit pushed above the release commit the atomic push
was refused as a non-fast-forward and sent nothing, the fetch and
`git branch -r --contains` named `origin/main`, and the tag pushed alone
landed on the release commit. The fixture's rejection is a hook's. GitHub's
server error was seen on the one day and cannot be staged, and the peer case
has not happened to a release. In this repo the four commits pushed beneath
`e7210be` have no workflow run and `e7210be` has one, which is why the peer
case sends step 7a to the pushed tip. The rule landed in `a53a48c` and this
entry in a commit of its own: another session's uncommitted entry stood at
the end of this file, and a zero-context hunk cannot be divided between two
sessions. `sync-toolchain.mjs --check` run from this repo's working tree
reported five drifted files in `foundryvtt-acks-extras`, four of them other
sessions' uncommitted canon, so the sync ran from a clean clone of the pushed
commit, which reported one.

## 2026-10-07 — The edit ledger and the shared-tree guard — IN FORCE

**Problem.** The first two of the tools ruled on this date under "A worktree
or a branch per session is rejected, and what is left lands as tools". Whose
hunk was whose stayed a claim, made by a pattern a session wrote and a
listing it read. And nothing stopped a hand-run `git add` or `git commit`, so
the commit tool was one way to commit among several.

**Built.**

- `.claude/hooks/edit-ledger.mjs` runs after every Edit and Write and appends
  one record under the session's id in `<git dir>/acks-ledger/`: the file's
  path, and its content before and after.
- `.claude/skills/acks-commit/ledger.mjs` replays a file's records in order
  and answers, for each line the working tree holds, which session wrote it,
  and for each line taken out, which removed it.
- `commit-own-hunks.mjs` reads that. A `change.json` that names no path takes
  every line this session wrote and no other. A pattern still takes what no
  record accounts for, and can no longer take a line the ledger gives another
  session.
- `.claude/hooks/shared-tree-guard.mjs` runs ahead of every `git` command in
  Bash and every PowerShell command, and refuses the ones that write the
  shared index, make or move a commit, or discard a path's changes.

**Found while building.**

1. *A record is worth its `pre`.* The Edit and Write tools report the file as
   they found it, and a patch. The hook keeps the reported file only where
   the patch undone over the file on disk gives the same text, and with no
   reported file keeps the undone patch. A difference between one record's
   content after and the next record's content before is a writer no hook
   saw: a script, a formatter, a session older than the hook. Those lines are
   nobody's, and so are the lines of a record with no `pre`.
2. *Git's hunks are not the replay's.* Two edits by one session, a paragraph
   added and a blank line removed, came out of `git diff -U0` as one line
   replaced and one line moved. Read hunk by hunk, half of the session's own
   change had no writer. So a file whose only writers since a committed
   content are this change's sessions is taken entire, however git divides
   it. A file with other writers is read hunk by hunk, each hunk at every
   place its lines let it slide to. A hunk two such places give to different
   writers is nobody's to take, and the sessions among them still stop a
   pattern from taking it.
3. *Two sessions' lines in one hunk divide.* Entries appended to one file by
   two sessions are one hunk to git. The tool takes this session's lines of
   it where every line has a writer and this session removed every line the
   hunk removes, and leaves the rest in the working tree.
4. *The guard judges a command by its repository.* The commit tool's own
   scratch clone, a test fixture and a probe all commit by hand, by design.
   A command is refused only where the repository it runs in carries the
   commit tool and its `origin` is a remote URL.
5. *Unstaging has to pass.* A session between `git add` and `git commit`
   when the hook arrives is refused its commit, and a run of the tool that
   dies while staging leaves the index held. `git restore --staged` and
   `git reset` of paths write no file and move no branch, and are the way
   out of both.
6. *A hook process costs about a third of a second here.* The ledger is one
   hook after the write, with no second one before it.
7. *The ledger keeps whole copies.* The directory above these repositories
   is a repository too, so a hook that recorded wherever it found a `.git`
   would have copied a local-only rules extract, or a machine's environment
   file, into that repository's git directory. It records only where the
   repository carries the commit tool, and only a file git does not ignore.

**Rejected — a snapshot hook before each edit.** It would give `pre` without
trusting the tool's report, at twice the cost on every edit, and the report
checked against its own patch gives the same.

**Rejected — crediting an unseen change to the session whose record comes
next.** It hands that session a script's lines, or a peer's from before the
hook reached it.

**Rejected — telling two removed lines of the same text apart by which is
older than the ledger.** It is wrong once a line has been removed, committed
and written again. Two tombstones with different removers are nobody's.

**Rejected — refusing every `git reset` and `git restore`.** It leaves stale
staging that no session can clear.

**Cost.** About a third of a second on every Edit, Write, `git` command and
PowerShell command. What a script writes is still claimed by a pattern and
read in a listing. Lines that repeat their neighbours can end as nobody's
where two sessions wrote in one file. The guard reads the command as text: a
command a shell builds at run time (`sh -c`, `xargs`, an alias) passes, so it
stops a habit and is no boundary. A record is kept fourteen days after its
session last wrote, so a change older than that is nobody's.

**Checked before this commit, and not.** Offline:
`bin/test-shared-tree-hooks.mjs` and the ledger cases of
`bin/test-commit-own-hunks.mjs`, with each of 64 single edits to the hook, the
reader, the guard and the tool turning at least one case red. The hook was
also fed the results this session's transcript holds for four of its own Edit
and Write calls, and gave each line to the session. Not checked: either hook
running under Claude Code. What a PostToolUse payload carries is read from the
SDK's types and from those transcript results. Whether a running session
takes up a hook that arrives by sync, and whose session id a subagent's edit
carries, are unknown until one is live.

## 2026-10-08 — The landing lease, and a gate whose serial work runs side by side — IN FORCE

**Problem.** The last two of the tools ruled on 2026-10-07 under "A worktree
or a branch per session is rejected, and what is left lands as tools". A
commit that landed under another session's gate cost that session its gate or
a carry, and the gate was long enough for that to be the usual case: most of
its minutes were one process waiting on another.

**Built.**

- `.claude/skills/acks-commit/lease.mjs` is one file in the git directory,
  held by the run that created it. `gate`, `commit` and `ship` hold it while
  they run, `ship` from its gate through its commit. A run that finds it held
  names the holder and waits, twenty minutes unless `--wait` says otherwise,
  and exits 5 where the wait runs out.
- `tools/validate.mjs` checks the syntax of its files eight at a time, and
  starts the IP scan and the module's own validator beside its own checks.
  What each printed is shown whole, at the place it had.
- `acks-extras` runs its test suites, its importer's checks after the
  register lint, and its extra validator's child checks side by side, in a
  commit of its own. That repo's DECISIONS has the entry.

**Found while building.**

1. *A lease is taken only from a holder that is gone or has stopped.* Gone is
   a process id nothing answers to. Stopped is a heartbeat that stands still
   at two looks, twenty seconds apart: at one look, a machine waking from
   sleep shows every heartbeat as old.
2. *Removing a dead holder's lease is an exclusion of its own.* Two waiters
   that judged one lease dead would each remove what stood there, and the
   second would remove the first one's new lease. The removal happens inside
   a directory only one can create, and reads the lease again there.
3. *A holder that lost its lease is still running.* It asks before it stages,
   and stops where the lease is another's.
4. *A lease that is there and cannot be read looked like one just given up.*
   The asker went round without a pause that counted, for as long as the file
   stood. A single edit to the reader, made to see which case would fail, hung
   the suite instead. The looks that find nothing are counted now.
5. *The settings filter let `git.exe` past the guard.* The hook ran only for
   a Bash command that begins `git `, by a filter in `settings.json`, and the
   guard already knew `git` under any path or `.exe`. The filter is gone and
   the hook reads every Bash command, as it already read every PowerShell
   one. That is a node started per command: 0.2 s, measured while a gate was
   running.
6. *A refusal did not say where it judged.* A command after `cd "$DIR"` is
   judged in the session's project, since the directory is the shell's to
   compute. A scratch clone's `git reset --hard` was refused that way with no
   word of why. The refusal names the directory it used.
7. *A background command is stopped at a timeout it is given, and not
   otherwise.* One given ten minutes was stopped at ten; one given none ran
   thirteen. A `ship` that waits for the lease and then gates is run with
   none, and the skill says so.
8. *Most of what is left of the gate is one check.* On a copy of
   `acks-extras` at ae71ea0, `validate` started beside the tests took 277 s
   before and 160 s after, and the tests 109 s and 40 s. Each printed what it
   had printed, apart from its timings. The cookbook drift check there is one
   process recompiling the cookbook, 199 s of a 303 s `validate` when each
   child was timed, and nothing here shortens it.

**First live run of the two hooks (the entry above left it open).** A running
session took both up when the sync wrote `settings.json`, with no restart.
The guard refused `git add` in Bash, after a `cd`, under `git -C` into the
template, and in PowerShell, and passed it in a scratch clone. The ledger
recorded a Write as `create` and an Edit as `original`, each `pre` the `post`
before it, and a subagent's edit under its parent's session with the agent
named. A `change.json` of `{}` listed the one file the session had written,
and refused once that file was removed.

**Rejected — a queue, so the longest waiter goes first.** Each waiter would
hold a ticket that has to be taken from it when it dies, which is the lease's
own problem a second time. Waiters look every two seconds and the first to
look takes it. Revisit where a session is seen to wait through more than one
other's turn.

**Rejected — a named pipe or a socket as the lease.** The system gives it up
when its holder dies, which is the property wanted. On a POSIX system the
socket's file outlives the holder and has to be removed by a waiter, which is
the takeover in finding 2 without a place to put the exclusion, and a holder
cannot be read with `cat`.

**Rejected — holding the lease from a `gate` run to a later `commit` run.**
It needs a lease that outlives its process, and then nothing says when it is
abandoned. `ship` is the run that holds from gate to commit. `gate` and
`commit` run apart each hold it for their own length, and a commit that lands
between them is a moved base, as it was.

**Rejected — one shared helper that `validate.mjs` imports.** The validator
is copied alone into every scaffold and every test fixture. It keeps its
twenty lines, and a module that wants its own scripts side by side carries
its own helper.

**Rejected — leaving a check out where nothing it reads has changed.** The
ruling was the same checks.

**Cost.** Changes land one gate after another. Before, two disjoint changes
could gate at once and both land, one by a carry; now the second waits. A
commit made around the tool, the owner's or a session's from before the hooks
reached it, still moves a base, and exit 3 and the carry stand for it. A
suite that fails no longer stops the ones after it, so a red run lasts as
long as its suites do. What the scan and the extra validator print appears when
`validate` reaches their place, not as they run, and on standard output
whichever stream they wrote it to. A validator that throws at a check of its
own leaves the two running with nothing reading them. Two checks that write to one
scratch place would now collide; none does today, and nothing checks the next
one.

**Checked before this commit, and not.** In a scratch clone on this base:
`test-landing-lease: 17 cases … 0 failed`, `test-commit-own-hunks: 31 cases
… 0 failed` with the lease held, `test-shared-tree-hooks: 31 cases, 0
failed`, and `test-validate: 33 cases, 0 failed`, four of them new: a file
that does not parse, two reported in the order walked, and what the scan and
the extra validator print and how each one's exit counts. The validator
before this change passes the same 33. 26 single edits to the lease and to
the tool's use of it, and 11 to the validator's new parts, each turned a
case red. On the copy of `acks-extras` the validator was also run red:
three files broken, and one late importer check alone made to fail. Both
times it exited 1 and named what failed. The tool, holding the lease, gated
and committed this change in a scratch clone with a peer's hunk beside it,
and a second run that asked for the lease meanwhile stopped with status 5
and the holder's name. Synced from that commit into a clone of `acks-extras`,
the tool's gate there gave `npm run validate: exit 0 in 199s`, against 324 s
the day before, and 164 s once that repo's own change was in.

Not checked: two sessions' own `ship` runs meeting on a live repository; a
lease across a machine's sleep, which only a moved clock has shown; the
gate's length on a runner with two processors; and any system but Windows,
which this commit's CI run is the first to try.

## 2026-10-08 — The sync reads canon from a commit, holds what git cannot give back, and fails a target it did not read — IN FORCE

**Problem.** `bin/sync-toolchain.mjs` was written for one session in one
tree. It read canon from the files of the tree it ran in, skipped a repo for
any uncommitted path, and ended on its level line when it had read nothing.
On a tree several sessions write in, each of the three gave a wrong answer
with a green exit.

**Found.**

- **Canon was whatever lay on disk.** On 2026-10-08 a peer's uncommitted hunk
  in `skeleton/.claude/settings.json` made the bare `--check` report
  `.claude/settings.json` as drift in `acks-extras`, exit 1, while the same
  module tree read level against the pushed commit (47 files) and was green
  in CI. `--apply` from that tree would have copied the hunk into the module.
  Two sessions synced that day and each built its own way round it, a clean
  clone and a `git archive` of the pushed head. The manifest was read from the
  tree as well, so what counted as canon was a peer's to change, and an
  untracked or ignored file under a `COPY_DIRS` directory was canon too.
- **Nothing made `--apply` wait for the push.** §9's operating rule and the
  2026-08-05 ruling put the order in prose and in the skill, and the script
  would still write an unpushed commit, or an uncommitted edit, into a module.
  The incident §9 used to tell stays here: on 2026-08-01 a sync run between
  two template commits reddened every module repo at once on `CLAUDE.md`, the
  only `RENDER` entry, and its tell was a local `--check` reporting
  `0 file(s) drifted` while CI was red.
- **A repo was skipped for any uncommitted path, and the skip exited 0.** On a
  shared tree a module repo holds some session's uncommitted work most of the
  time; the one sync of that day waited for a moment `acks-extras` was clean.
  The skill said not to use `--force`, which was also the only way through,
  and which overwrote an uncommitted synced file as readily as it ignored an
  unrelated one. A skipped repo was counted as one "file written/skipped-dirty".
- **A run that read no repo ended `done: 0 file(s) drifted from canon`, exit
  0.** A target directory that was missing, or held no `module.json`, was
  skipped with a line. From a clean clone the default target is looked for
  beside the clone and is not there, which is how this was found: the way
  round the first flaw walked into the fourth. `bin/nightly.mjs` reads the
  exit status and would have written "clean". An argument the script did not
  know was read past, so a mistyped `--apply` was a check and a mistyped
  `--repo-path` was the default targets.

**Ruled by the owner, 2026-10-08.**

1. **Canon is a commit.** `--apply` writes `origin/main` as the run fetches it
   and takes no other canon. That makes the 2026-08-05 order a mechanism: a
   module cannot be synced ahead of the template, because the sync has nothing
   unpushed to write. `--check` reads the same commit; `--from <rev>` and
   `--worktree` preview a commit or the tree, and `--apply` refuses both. The
   commit is exported through an index of its own and the sync runs from the
   export, so the engine and the manifest are that commit's too. The run names
   the commit and lists the canon in the tree that it did not read.
2. **`--apply` destroys nothing git cannot give back.** A repo is held, whole,
   where a path the sync would write or remove is modified, staged, untracked
   or ignored: nothing is written in it, the paths are named, exit 1. Any
   other uncommitted path is not looked at. `--force` writes the held paths
   too.
3. **A target that was not read fails the run**, exit 2, and so does an
   argument the script does not know. Such a run ends `not done:`, never on
   the line a level run ends on, and `bin/nightly.mjs` writes it up as NOT
   CHECKED.
4. **The script holds what files can decide; the skill holds what needs a
   judgment**: whose a held path is, when `--force` is right, and what to do
   when another session's canon is on the branch as well.

**Built.** Two commits. `7603b06` gave the script its canon, its hold and its
exit statuses, with seventeen cases and their CI step, and left `--check` on
the working tree where no flag named a canon: every module's CI runs this
script from `main` on each push, and until that commit's own CI the export
had run on Windows alone. This commit moves the default and has the module
workflow ask for `--worktree`, since its checkout is the canon and the bare
check would fetch the branch a second time. A workflow not yet synced goes on
passing the old command line, which now fetches and compares with the same
commit. A case reads the workflow's command line out of `skeleton/` and runs
it, so a flag the script stops reading fails in this repo's CI and not in
every module's.

**Found while building.**

1. *git moves `origin/main` whether or not a fetch names it.* A fetch given
   some other destination still moved the branch's ref, because the clone's
   own fetch configuration names every branch. A copy of the script that
   fetched into the wrong ref passed all fifteen cases there were. Only in a
   clone configured for another branch does the script's own refspec do the
   work; a case stages one, and that copy fails it.
2. *The check that a run leaves the shared index alone could not fail where
   it stood.* It looked for staged paths after the run, and a run that read
   the pushed commit into the shared index would have left none, that commit
   being the tree's own. Only the case that fetches another clone's commit
   showed such a run. The check now stages a file before the run and looks
   for it after, and a copy that exports through the shared index fails both.
3. *A status left to its default reports a directory that is ignored whole as
   one entry*, which names none of the files in it: `!! ign/` for a file two
   levels down, in a scratch repository. The script asks for every file by
   name, and a case ignores a directory whole.
4. *A status rewrites the index of the repository it reads* where a file's
   timestamp has moved and its bytes have not, and holds the lock a peer's
   `git add` needs while it does. Every git call here runs with
   `GIT_OPTIONAL_LOCKS=0`, and a case compares the index's bytes.
5. *The directory the family's repos stand in is a repository itself.* A
   module copy with no `.git` of its own is a directory of that one: git
   reports its paths from that one's root, and its files are held by what
   that one has not committed.
6. *The variable a run sets for its engine is not a lock.* The first version
   took any directory the variable named, a working tree included. An engine
   now runs only from a directory that holds no `.git`, which an export never
   does and a tree always does. A copy with no history that sets the variable
   for itself still runs as one and writes its own files, 45 of them into a
   scratch module. That takes a copy made on purpose and a variable no
   document names.

**Rejected — `--apply --from <rev>` for a commit that is not pushed.** A
module's gate could then run before the template push, and the time a module
trails the template would fall from one module gate to about a minute. The
order would be an instruction again, and that instruction was broken once
after it was written. The window it would shorten has cost one red run in the
last hundred `Toolchain check` runs on `acks-extras`, and that one
(2026-09-24, a release commit, `tools/ip-scan.mjs`) trailed a template commit
made seven hours before it, not a gate.

**Rejected — moving `--apply` alone and leaving `--check` on the tree.** Module
CI's path would not change at all. The bare check is what a session, the
nightly and the release procedure run, and it would go on reporting a peer's
uncommitted edit as drift and passing a module that matches an edit nobody
has pushed.

**Rejected — keeping the tree, and refusing to run where it differs from
`origin/main`.** Every sync and every check would stop while any session had
an uncommitted edit under `skeleton/`, which was the state of the tree for
the whole of the day this was ruled.

**Rejected — writing the clean-clone recipe into the skill.** No code. It is
the work instruction the 2026-10-07 ruling on tools declines, for a step two
sessions had already had to work out alone.

**Rejected — reading canon out of git file by file, in the tree's own
engine.** One process and no scratch directory. The engine and the manifest
would still be the tree's, so a peer's edit to either would decide what a sync
writes, and the manifest could never import anything.

**Rejected — holding per file and writing the rest.** A repo with part of its
canon written fails the drift check as surely as one with none, and has to be
finished or undone by hand.

**Rejected — never holding.** A synced copy that differs is usually a
hand-edit the doctrine forbids. It is also an apply somebody interrupted, or a
peer's sync between its write and its commit, and an uncommitted byte that is
overwritten is gone.

**Rejected — failing only a run that read nothing.** A run over two targets
that read one would still exit 0, and the nightly would still write "clean"
for a repo it never opened.

**Not decided here.** `bin/make-blank.mjs` regenerates `blank-template/` from
the tree as it stands, so a peer's uncommitted `skeleton/` edit rides into the
copy, and the CI step that compares the two sees it only once it is
committed. The module's side of a check is still the files on disk. Nothing
stops a module push while the module trails the template; a drift check at
push time would, and would also stop a peer's unrelated push for as long as
someone else's sync is in flight.

**Cost.** A module trails the template from the template's push until its own
sync is pushed, one module gate at the least, and a module push inside that
window fails `drift`. An edit cannot be tried in a module before it is
pushed, only previewed with `--check --worktree` or `--from`. A run from a
commit fetches, exports the tree (107 files, well under a second here) and
starts a second process. A session whose own interrupted apply left synced
files behind is held by them and has to say `--force`.

**Checked before this commit, and not.** On Windows,
`test-sync-toolchain: 17 cases … 0 failed`; the same line on the Linux
runner, in 11 s, in `7603b06`'s CI. 23 single edits to that commit's script,
each taking one behaviour out, each turned a case red. That commit's script
fails three of this commit's cases. This commit rewrites or adds to four
cases; the edits those cases catch were made again to this commit's script,
and each is still red. From the shared tree, with five uncommitted paths of
canon in it, one of them a peer's, the bare check read `origin/main`, listed
the five as canon it did not read and ended level on 47 files, exit 0;
`--check --worktree` reported four of them as drift in `acks-extras`, exit 1.
A `Toolchain check` dispatched on `acks-extras` ran `7603b06`'s script on a
runner under the workflow's old command line: 47 files read, 0 drifted.

Not checked: this commit's default under the old command line on a runner; an
`--apply` into a real module repo, which the sync after this commit is the
first of; a staged rename among the paths to be written; a fetch that hangs
to its limit, or one refused for a credential; the nightly's new label, which
was read and not run; and macOS.

## 2026-10-09 — `blank-template/` is retired, and the scaffolder says whether the module it built is level with canon — IN FORCE

**Problem.** The entry above left `bin/make-blank.mjs` undecided. It copied
`skeleton/` as the tree held it into `blank-template/`, a tracked folder for
starting a module by hand, and a CI step regenerated the folder and compared.
On a tree several sessions write in, the copy took whatever lay under
`skeleton/` at that moment, and the step could see it only in a commit.

**Found.**

- **A peer's uncommitted edit rode into the copy.** In a scratch clone with
  one uncommitted edit standing in for a peer's and one of the session's own,
  a regeneration changed both files of the copy. Committing the session's own
  change with `blank-template/` taken whole put the peer's line in the commit.
  On the day of the ruling a run in the shared tree would have copied a peer's
  pending hunk in `skeleton/.claude/settings.json`, and the session that
  synced that day edited the copy by hand to keep it out.
- **CI saw it once it was committed, and not before.** The step regenerates
  in a checkout, so it compares a commit with itself. It failed on a fresh
  clone of that scratch commit. The step was a day old (`6dbb3f3`). Before it
  nothing compared the two, and 15 of the 54 commits that changed `skeleton/`
  after the folder was made left the copy as it was.
- **The folder was replaced by removing it.** It is absent, then part-written,
  for the length of the copy: 115 ms at the median over twenty runs, on a
  machine running a test suite beside it. This is the least of the three.
- **A module started from the folder had not been a family module since
  2026-08-18.** That day the skills, rules, hooks and agents became canon at
  the template's root, and `bin/new-module.mjs` learned to copy them and
  `make-blank` did not. The same id through both paths gave 23 files against
  56. The by-hand module's `settings.json` started four hooks it did not have,
  and the drift check read `34 file(s) drifted`. No CI step ever ran
  `INIT.mjs`.
- **A scaffolded module started off canon as well.** The manifest has enforced
  `scripts.prepare` since 2026-07-18 and `skeleton/package.json` never carried
  it. A new module failed its own first drift check on that line, and its
  first install armed no pre-commit quarantine. Template CI built a scaffold
  on every push and compared it with nothing.
- **The scaffolder reads the tree as `make-blank` did.** A module made beside
  a peer holds that peer's uncommitted canon, in its first commit.

Nothing under `blank-template/` is in the manifest, so no module repo held a
file of it. What replaces the folder was already there and was the only path
that built a whole module, which is what the 2026-08-15 lesson asks of a
retirement.

**Ruled by the owner, 2026-10-08.**

1. **`blank-template/` is retired**, and `bin/make-blank.mjs` and
   `bin/blank-init.mjs` with it. `bin/new-module.mjs` is the one way a module
   is started.
2. **The scaffolder keeps reading the tree, and the module is checked as it
   is made.** The run ends by having the sync's `--check` compare the module
   with `origin/main`, and says whether it is level, naming any path that is
   not.
3. **`skeleton/package.json` carries `prepare`, and template CI fails where a
   fresh scaffold is not level with canon.**
4. **One template commit, pushed, then `acks-extras` synced and pushed.**

**Built.** `bin/new-module.mjs` builds the module as it did, then runs
`sync-toolchain.mjs --check --repo-path <module>` and shows what that prints,
less the files read level. Its last line is the verdict: `level:` and exit 0,
`not level:` and exit 1 with the command that writes the pushed branch over
the files named, `not checked:` and exit 2. `--pushed`, `--from <rev>` and
`--worktree` are the check's flags and are handed to it. A checkout is its
own canon, so CI's scaffold step says `--worktree`. An argument the script
does not know, a flag with no value, a second id or a second canon is refused
before anything is written, exit 2. `bin/test-new-module.mjs` has ten cases
and a CI step of its own. The step that regenerated the folder is gone with
it, and the sync skill loses the step that ran `make-blank`.

**Found while building.**

1. *The sync already says what the scaffolder owed its reader.* Its note
   lists every path under `skeleton/` and the shared trees that the tree
   holds and the branch does not, whether or not the sync writes that file. A
   scaffold-only file a peer is editing is named that way though the module
   reads level. The scaffolder adds the verdict and nothing else.
2. *An exit status does not say the check ran, or that the build did.* node
   exits 1 for a script it cannot load, which is the check's status for
   drift, and 0 for an empty file, which is its status for level. A script
   another session is halfway through writing can be either, so the verdict
   asks for the check's own `done:` line as well. node's status for an error
   nothing caught is 1 too: a first commit git refused ended as a module that
   differs does. The build is caught, ends `not checked:` with exit 2, and
   leaves the directory for its maker to remove. A case stages each.
3. *The command a verdict names is read in another directory.* The first
   wording named `bin/sync-toolchain.mjs` as the template's root sees it, and
   its reader stands in the new module. It names both paths whole, in quotes.
4. *A runner has no committer until the step that names one.* The suite runs
   before that step and the scaffolder makes a first commit, so the suite
   names the committer in the environment it gives git. With no identity
   configured anywhere it passes the same ten.

**Rejected — building the folder on demand, outside git.** `make-blank.mjs
<dest>` would write a whole copy, shared trees included, and the scaffolder
would be rebuilt on it so that CI ran one implementation for both paths.
About sixty lines kept for a path with no sign of use: it built a module
short of 33 files from 2026-08-18 and nobody met it.

**Rejected — keeping it tracked and regenerating only the paths a session
names.** It stays a second statement of canon. Made whole it is 58 files
that 70 of the last 100 commits would have had to regenerate, and a file two
sessions are editing still mixes their hunks in the copy.

**Rejected — keeping it tracked and mirroring each edit by hand.** Every
canon edit is typed twice so that the ledger credits both, and the script
only compares. The same 58 files, and a second place to forget.

**Rejected — scaffolding from a commit, as the sync reads canon.** It is the
consistent rule, and it prevents where the check only reports. It means
moving the export out of `sync-toolchain.mjs` into a file both scripts share,
on the day that script landed, and every module's CI runs that script from
`main`. A scaffold is rare, its first push already fails `drift`, and the
check costs one process.

**Rejected — deriving the folder inside the commit tool's gate clone.** It is
the general answer to a generated file on a shared tree. It gives the one
tool that writes to the branch a way to commit files no session wrote, for
one folder.

**Rejected — adding `prepare` and no gate.** The line was missing from
2026-07-18 with a scaffold built on every push. The next disagreement between
`skeleton/` and the manifest would stand as long.

**Not decided here.** `tools/ip-*.mjs` at the template's root are tracked
copies of `skeleton/tools/` files that a CI step compares, the same kind of
thing as the folder: a copy made from the tree takes a peer's hunk with it.
A file the sync does not write is named when the tree's differs from the
branch's and is not compared, so a peer's uncommitted README is in the module
with a level verdict over it.

**Cost.** The copy-me folder is gone: a module is started by running the
script. A scaffold made beside uncommitted canon exits 1, and its maker runs
one `--apply` and makes one commit in the new repo before going on. The
scaffolder's check fetches and starts a second process. A usage error exits 2
where it exited 1, and a caller that read the exit status as made or not made
has three answers to read.

**Checked before this commit, and not.** In a scratch clone on this base, on
Windows: `test-new-module: 10 cases … 0 failed`, and the same ten with no git
identity configured. 30 single edits to the scaffolder, each taking one
behaviour out, each turned a case red. A replay of this repo's CI steps
passed its thirteen stages on that tree, the scaffold stage ending `level:`,
before the tenth case and what it guards were added; the suite and the edits
were run again after. Before the build, also in scratch: a regeneration
beside two uncommitted edits changed both copies, and the CI step failed on a
clone of the commit that took the folder whole; one id was put through the
folder and through the scaffolder, and each module through the drift check.

Not checked: the suite on the Linux runner, which this commit's CI run is the
first to try; a scaffold from the shared tree itself, where the module would
land beside the family's repos; the `not level` remedy in a module anyone
keeps, which a case runs in a throwaway one; a check whose fetch hangs or is
refused, which is the sync's own; and macOS.

## 2026-10-10 — This repo's hook runs the quarantine in `skeleton/`, and no copy of it sits at the root — IN FORCE

**Problem.** The entry above left `tools/ip-scan.mjs` and
`tools/ip-quarantine.mjs` undecided. They were tracked copies of the
`skeleton/tools/` files: this repo's hook ran them and a CI step compared
them (2026-09-09). A change to canon refreshed them by copying the skeleton
file as the tree held it. On a tree several sessions write in, that copy
holds whatever lies in the skeleton file at that moment.

**Found.**

- **A peer's uncommitted hunk rode into the copy, and nothing refused it.** In
  a scratch clone the skeleton's scanner held two uncommitted hunks, one a
  peer's by the ledger and one the session's own, and the copy was refreshed
  with a file copy. The commit tool listed the skeleton file as `2 hunk(s), 1
  this change's, by the ledger`, the peer's hunk `left`. It listed the copy
  as `2 hunk(s), 2 this change's, taken whole`, the same hunk `MINE` with no
  writer beside it: no record names a file a copy wrote. The commit held the
  peer's line in `tools/ip-scan.mjs` and not in the skeleton file.
- **CI saw it at the push. A gate saw it only where its session had written
  the step in.** This repo has no `package.json`, so the commit tool has no
  default gate here and each session lists its own stages. With the `cmp`
  among them the gate was red and nothing was committed. Without it the
  commit landed and the step failed on it. The step fails the same way on a
  commit that changes canon and leaves the copy alone. TOOLCHAIN and the
  skills described no refresh, so that failure was what told a session to
  make one.
- **The copies had two readers.** The hook ran `tools/ip-quarantine.mjs`,
  which imports the scanner beside it. The commit tool's leak scan imports
  `tools/ip-scan.mjs` before it stages, and no case covered it. Both read the
  disk. With the copy refreshed and not committed, a rule that only the
  peer's pending hunk held took a file out of a hand-run commit, and refused
  a change the commit tool had gated green.
- **The hook was a third copy, compared with nothing.** `.githooks/pre-commit`
  was byte for byte the file in `skeleton/.githooks/`, and the CI step
  compared `tools/*.mjs`.
- **A level copy could be made with the tool as it stood,** in five steps:
  record, build, write the copy from the built tree's blob, record, ship. The
  commit came out level, with the peer's hunk left in the tree.

**Ruled by the owner, 2026-10-10.**

1. **The root copies are deleted.** This repo's hook runs
   `skeleton/tools/ip-quarantine.mjs` where it stands, and the commit tool's
   leak scan asks the scanner that hook runs.
2. **One template commit, pushed, then `acks-extras` synced and pushed.** The
   commit tool is a synced skill.

**Built.** `.githooks/pre-commit` is this repo's own file and runs
`skeleton/tools/ip-quarantine.mjs`, which imports `ip-scan.mjs` from beside
it. `skeleton/.githooks/pre-commit`, the hook every module is synced, is as
it was. `tools/` is gone from the root, and the `cmp` step with it.
`commit-own-hunks.mjs` asks the scanner in `tools/`, and the one in
`skeleton/tools/` where `tools/` holds none. `bin/test-pre-commit.mjs` arms
the hook in throwaway repositories: four cases, with a CI step in the place
the `cmp` had. `bin/test-commit-own-hunks.mjs` gains the leak scan's first
three cases. `docs/LICENSING.md` says which file reads a commit made here.

**Found while building.**

1. *Deleting the copies alone moves the refusal to after the commit.* With no
   scanner in `tools/` the leak scan returned without asking. The hook then
   took the flagged file out, and the tool reported `the commit is NOT the
   gated tree on its base` over a commit already made. With the second place
   to look it refuses before anything is staged.
2. *A hook's exit status is half of what it does.* A hook that ran the
   quarantine and then exited 0 passed every case that watched a file leave
   a commit. The quarantine also refuses outright, where HEAD already holds
   the banned file, and only a case that stages one fails such a hook.
3. *Git starts a hook at the top of the work tree.* The hook's path is from
   there, and a commit run in `docs/` finds the quarantine. One case commits
   from a subdirectory, and a hook that first changes to the directory git
   was run in fails it.
4. *The hook's file is not executable as tracked.* The index holds mode
   100644 for it, here and in `skeleton/`. Git on Windows runs it. Git's
   manual asks for an executable file, so the suite sets the mode on its
   copy before arming it. What a clone on Linux or macOS does with the
   tracked mode is left open below.

**Rejected — files at the root paths that forward to the skeleton's.** No
synced file changes and no module is synced. `node tools/ip-scan.mjs` then
exits 0 and prints nothing in a tree where the skeleton's scanner exits 1:
the scanner runs as a command only when it is the file node was given. The
hook stays a copy, and two files stay that are not what their names say.

**Rejected — keeping the copies and writing them from the built tree.** It
keeps committed canon as the gate here, as it is in every module. It is the
five steps above for each change to the scanner, or a script and a suite to
wrap them, and it stays a step a session can leave out. The copy cannot come
from `HEAD`: CI compares the two files of one commit.

**Rejected — keeping the copies under a rule that every gate list repeats
the `cmp`.** Nothing is built and nothing is pinned. A session that leaves
the stage out learns from a red `main`, as before.

**Rejected — running `HEAD`'s blobs.** The hook and the commit tool would
write `HEAD:skeleton/tools/` into a scratch directory at each commit and run
that: no copy, and no uncommitted canon in the gate. It needs a hook script,
a fallback for a first commit and the same reader in the commit tool, and a
fix to the scanner is judged by the scanner before it.

**Not decided here.** The tracked mode of `.githooks/pre-commit`, here and in
`skeleton/`, and with it whether a clone on Linux or macOS runs the hook at
all: no run was made there. `ip-quarantine.mjs` has no suite of its own. The
hook's cases run three of its paths, and the commit it abandons when a
banned file was all that was staged is not one of them. The commit tool's
default `tooling` pattern names `tools/ip-*.mjs` at a root, so a base carried
here counts a landed change to `skeleton/tools/` as gate tooling only where
the change's own `tooling` says so.

**Cost.** The gate a commit meets here is canon as the working tree holds
it. A session's uncommitted edit to the scanner or the quarantine gates every
commit made in this repo for as long as it is open, where a copy took one in
only between a refresh and its commit. One that does not parse stops every
commit here until it does: a hand-run commit exits 1, and the commit tool
stops after its gate with nothing staged. One that weakens a rule is seen by
nothing at commit time, and CI's scan of the pushed tree with the committed
scanner is what is left. The commit tool looks in a second directory that no
module repo has. `node tools/ip-scan.mjs` at this root finds no file. The
hook here and the synced one are two files, and a change meant for both is
made twice.

**Checked before this commit, and not.** In scratch clones on this base, on
Windows. Before the build: the listing and the commit under "Found"; the gate
with the `cmp` stage and without it; a hand-run commit and a commit-tool
change each met by a rule that only a pending hunk held; the five-step copy;
and, with the copies deleted, the tool as it stood committing short of its
gated tree. After it: `test-pre-commit: 4 cases … 0 failed` and
`test-commit-own-hunks: 34 cases … 0 failed`, where the tool as it stood
fails the one case that keeps the scanner in `skeleton/tools/`. 19 single
breaks, 10 of the leak scan and 9 of the hook and the tree around it, each
turned a case red. A replay of this repo's CI steps passed its thirteen
stages on the built tree; one comment in the commit tool was reworded after
it, and that tool's suite was run again. In a clone of the built tree the
commit tool refused a change holding a banned path before it staged
anything and committed the same change without the path, and a hand-run
commit from `docs/` had the path taken out of it.

Not checked: either suite on the Linux runner, which this commit's CI run is
the first to try, and which is the first to arm a hook there; a clone on
Linux or macOS with the hook at its tracked mode; a commit by another
session through this hook; and macOS.

## 2026-10-10 — The commit-time gate judges what the commit would hold, and the quarantine has a suite — IN FORCE

**Problem.** The entry above left `ip-quarantine.mjs` with no suite of its
own; the hook's cases ran three of its paths. Nothing had ruled on what the
gate reads, either. The quarantine listed the staged paths and the scanner
opened each one in the work tree, and the commit tool's leak scan asked the
same way. A commit is made from the index, and the commit tool's from a tree
built of one session's hunks, so the file judged and the content committed
could differ.

**Found.** In scratch clones at `166366f`, on Windows, every path the entry
above named was walked, with the commits around them.

- **What held.** A banned file that was the whole staged set was taken out
  and the commit abandoned, on a repository's first commit as on a later
  one. The ignore list got its header once and a path once, and a last line
  with no line end was kept whole. A banned path deleted from disk after it
  was staged was still taken out, since its name is what is judged. A file
  moved into a banned directory was taken out at its new path.
- **A flagged file was committed, six ways.** A notice staged and then
  taken out on disk, or its file deleted or left half-written there: the
  commit held the notice. A name with ` — ` in it: the path was read back
  out of the error line by splitting at the first `:` or ` — `, came back
  short, matched nothing staged, and the file was committed, as the whole
  staged set too. A change of type, which the staged listing left out: a
  path HEAD held as a link, staged as a file with a notice. A file under
  `RuleData/` in a repository with no `ruledata/` yet. A notice in a data
  file under `Lang/`. A notice in a data file that does not parse.
- **A commit deleted a clean tracked file.** The quarantine unstaged with
  `git rm --cached -- <name>`, and git reads the name as a pattern. With
  `lang/[ab].json` flagged, the commit removed `lang/a.json`, which HEAD
  held and the same commit had changed.
- **A commit was stopped for nothing it held, or the hook died.** A flagged
  new file edited after it was staged: `git rm --cached` refuses an entry
  that differs from both the file and HEAD, the hook ended on a stack
  trace, and every retry did the same. A new file staged clean, with a
  notice written into it afterwards, met the same refusal. In a linked
  worktree `.git` is a file, and making `.git/info` under it threw.
- **The stop said the wrong thing.** `ALREADY COMMITTED … Purge them from
  history` was printed for a file HEAD held clean: where the staged change
  was what brought the notice in, and where the notice was on disk and in
  neither.
- **An ignore-list line was the path as it stood.** Git reads it as a
  pattern. `RULES.md` also ignored `docs/RULES.md`. A name with `[` in it,
  or a leading `!` or `#`, was not ignored by its own line, and one ending
  in a space lost it.
- **The commit tool refused a change for a peer's line.** Its leak scan
  read the disk as well. With a notice in a peer's uncommitted hunk of the
  same file, that reading refuses a change that does not hold it.

A name with a `:` in it breaks at the same split as ` — `. No run was made:
git on Windows holds no index entry for such a name.

**Ruled by the owner, 2026-10-10.**

1. **The gate judges the staged content.** The quarantine reads the index
   git is making the commit from, and the commit tool's leak scan reads the
   tree it is about to commit.
2. **Every defect found is repaired in canon in this change,** and the suite
   pins the repaired behaviour.
3. **Two scanner gaps are closed with it.** A path is matched in any letter
   case, and a data file that does not parse is read as text for a notice.
4. **One template commit, pushed, then `acks-extras` synced and pushed.**
   Three synced files change.

**Built.** `scanPaths(root, paths, { from })` in `skeleton/tools/ip-scan.mjs`
reads each path's text from the index git is using or from a tree, and with
no `from` from the work tree as before. It makes two git calls whatever the
count, one that lists what is held and one that prints every blob wanted,
and none where no path given is one whose text is read. It returns
`flagged`, the paths it raised an error for. Its path patterns are matched
in any letter case, and a data file that does not parse is searched as
text. The scan run as a command, which `validate`, the nightly run and CI
use, reads the work tree as it did.

`skeleton/tools/ip-quarantine.mjs` lists every staged path that is not a
removal, a change of type included, and asks the scanner about the index.
It acts on `flagged` and reads no path out of an error's text. A flagged
file HEAD holds stops the commit, and a second question, about `HEAD`, says
which stop it is: history holds the material, or the staged change brings it
in. The rest leave the index through `git update-index --force-remove`,
which takes each name as it is written and refuses none for an edit. The
list is the file `git rev-parse --git-path info/exclude` names. A line is
anchored at the top of the work tree and escaped, so it matches its own path
and no other, and a name with a line break in it gets none. What is left
staged is scanned again before the commit goes on, and a leak the scanner
names no staged path for stops it.

`commit-own-hunks.mjs` hands its leak scan the tree it built.
`bin/test-ip-quarantine.mjs` is the suite: 28 cases through the hook a
module runs, with `--root` for a broken copy, and a CI step.
`bin/test-ip-scan.mjs` goes from 6 cases to 12 and counts a scan that throws
as a failed case. `bin/test-commit-own-hunks.mjs` gains two cases, a notice
in a peer's hunk and one in the change's own. `bin/test-pre-commit.mjs`'s
stub scanner returns `flagged`, and its first case asks git which list
ignores the file. `docs/LICENSING.md` Rule 3 says what the gate reads, what
each stop means, and which commits the hook is not asked about.

**Found while building.**

1. *The index a hook must read is not always `.git/index`.* Under `git
   commit -a` it is `.git/index.lock`, and under `git commit -- <paths>` a
   `next-index-<pid>.lock`. Git names it in `GIT_INDEX_FILE` and the hook's
   own git calls inherit that, so the scanner asks git and opens no index
   file itself. A case commits each way. After `git commit -- <paths>` the
   file taken out is still staged in the index git keeps, and the next
   commit takes it out again.
2. *A staged list over a megabyte killed the hook.* Node gives a child's
   output one megabyte unless told otherwise. 6,000 staged paths of about
   190 characters ended the quarantine as `166366f` held it on `spawnSync
   git ENOBUFS`. Both files name their bound, and one case commits that
   many paths and then commits over them.
3. *Git makes the commit a hook has emptied.* With the quarantine's last
   stop taken out, a commit whose whole staged set was flagged was written
   with no file in it: an ordinary one, an amended one and a repository's
   first. The stop is the quarantine's alone, and four cases fail without
   it.
4. *Git on Windows holds no index entry for six of the thirteen awkward
   names:* one with a `:`, a `*`, a `?`, a backslash, a trailing space or a
   line break. `git update-index` prints `Ignoring path` and exits 0. The
   suite asks git which names it will hold, leaves the rest out, says so on
   a `note` line, and fails off Windows if any is left out. The Linux
   runner is the first to stage them. Their ignore-list lines were checked
   on Windows by asking `git check-ignore` about paths never staged, all
   but the backslash's, which was not asked.
5. *The second scan needed a case for where it reads.* A break that turned
   it to the disk passed every case until one staged a file clean and wrote
   a notice into it afterwards.
6. *A scanner that returns no `flagged` stops every commit it flags.* Two of
   the four cases in `bin/test-pre-commit.mjs` went red against the repaired
   quarantine: its stub scanner returned none, and one case looked for the
   list's line as the old quarantine wrote it. A module that held the new
   quarantine beside the old scanner would meet the same stop, and one sync
   writes both.
7. *The scanner's exclusion of its own file follows its patterns.* With the
   patterns matched in any letter case, `Tools/IP-Scan.MJS` is that file
   wherever case is folded, so the exclusion matches the same way, and a
   case gives it that name.
8. *`git check-ignore` takes no `--literal-pathspecs`,* and exits 128. It
   reads each argument as a path, which is what the suite gives it.

**Rejected — leaving the disk reading and saying so in LICENSING.** No
synced file changes and no module is synced. The gate goes on judging a file
the commit may not hold: a staged notice is committed once it is gone from
disk, and a commit is stopped for a notice it does not carry. In a tree
several sessions write, the commit tool meets the second by construction.

**Rejected — reading both.** It closes the leak and keeps the wrong stop: a
commit is refused for a notice in the working copy that it does not hold,
and a session whose change is clean has nothing of its own to fix. The
notice on disk is judged when it is staged.

**Rejected — keeping the error line as the source of paths, under a stricter
pattern.** A file's name can hold any mark the scanner's messages are
written with, so every pattern has a name that breaks it. Returning the
paths costs the scanner one array.

**Rejected — `git rm --cached -f`.** It takes out an entry edited after
staging. It still reads each name as a pattern, which is the deleted file
under "Found". One break in the mutation run is this command, and one case
fails it.

**Rejected — taking a flagged change to a tracked file out of the index and
committing the rest.** Git does not ignore a tracked file, so the next `git
add` stages the change again and the next commit meets the same gate. The
commit made in between would lack a change its author staged, with a line on
stderr to say so. The stop is made once, at the file that needs the fix.

**Not decided here.** A merge, a cherry-pick and a rebase make commits the
hook is not asked about. In a scratch repository each brought a banned path
from a side branch into HEAD with nothing said; `git merge --no-commit`
followed by `git commit` had it taken out. CI's scan of the pushed tree is
what reads those commits. A name with a line break in it cannot be put on
the ignore list, so it is taken out of each commit that stages it. The
scan's warnings are not shown at commit time. The lines an earlier
quarantine wrote stay on each machine's list as they are. The commit tool's
default `tooling` pattern still names no file under `skeleton/tools/`.

**Cost.** A commit that stages a file whose text is read makes two more git
calls. On Windows, in a tree of 2,000 pack sources, a commit of one data
file, one source file and a note took a median 660 ms where it took 520 ms,
against 193 ms with no hook armed. A notice in the working copy is seen by
no commit until it is staged; `npm run validate` still reads the disk. A
flagged change to a file HEAD holds stops the whole commit, as it did. A
path under `Lang/` or `RuleData/` is flagged where the filesystem tells
those from `lang/` and `ruledata/` as well. A scanner must return `flagged`
for a file to be taken out. The suite adds about a minute to a gate on
Windows.

**Checked before this commit, and not.** In scratch clones, on Windows. With
the quarantine and scanner as `166366f` held them: every bullet under
"Found" but the last, the name with a `:` apart; the list line of a name
that ends in a space was written by hand, as that quarantine writes one. The
last is the commit tool's reading put back, which is one of the breaks
below. With the build, on this base: `test-ip-quarantine: 28 cases … 0
failed`, and `19 failed` against the quarantine and scanner as `166366f`
held them; `test-ip-scan: 12 cases … 0 failed`, and `6 failed` against that
scanner; `test-commit-own-hunks: 36 cases … 0 failed`; `test-pre-commit: 5
cases … 0 failed`. Of 47 single breaks, 22 of the scanner, 23 of the
quarantine and 2 of the commit tool, 43 turned a case red. The other 4 did
not, each for a reason the run states: two are caught only by names git on
Windows cannot stage, one is a flag that changes what a listing costs and
not what it holds, and one reads the index entries of a merge in progress,
which git does not commit. The repaired scanner, run as a command over this
repository and over `acks-extras`, printed what the scanner before it
printed. The commit tool made this commit behind a replay of this repo's CI
steps, 14 stages on the tree it holds; the step left out is the last, which
asserts nothing.

Not checked: any of it on Linux, where this commit's CI run is the first to
run the suite, to stage the six names and to commit through a linked
worktree there; a backslash in a name against its ignore-list line; a peer's
real hunk through the commit tool in the shared tree, which a case stands in
for; the hook's cost in a module; and macOS, where git may hand a name back
in another Unicode form than it was staged in.
