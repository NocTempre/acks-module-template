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

## 2026-08-15 — Math may ship; the book's words may not

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

**Enforcement.** `ip-scan.mjs` gains a citation signal: a book sigil next to a
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
