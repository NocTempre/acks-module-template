# Table Extraction Program — acks-location & the people/hirelings cookbooks

> **STATUS: APPROVED 2026-07-19 — executing.** Owner rulings recorded §4.
> This program pulls the tables registry forward from
> [REFACTOR_PLAN.md](REFACTOR_PLAN.md) Phase 1 (the same scoped-early-start
> pattern as acks-lib v0.1) and **supersedes [FAMILY.md](FAMILY.md) §3c** on
> one point: the wage ladder does NOT ship as `ruledata/economy.json` in
> acks-lib — no book-read value ships in any repo. FAMILY.md/REFACTOR_PLAN.md
> banners are updated when their own phases land; conflicts with this page
> resolve in this page's favor for the surfaces named here.

## 1. Why (2026-07-19 audit of acks-henchmen)

acks-henchmen shipped its rules tables as `ruledata/*.json` — publicly, in
the repo and in every release zip since v0.1.0. Classification:

| Exposure | Where | Nature |
| --- | --- | --- |
| Highest | `people.json` cultures | RR 495–503 + BTA name lists & appearance palettes — expressive creative content, near-verbatim |
| High | `rarity.json`, `wages.json`, `availability.json`, `followers.json`, `slavery.json`, JJ tables in `people.json` | verbatim numeric table dumps (RR 162–173/334–337, JJ 118–119/245–257/409–411, JS-inserts double-d100 grid) |
| Moderate | `monsters.json`, `classRegistry`, `throws.json`, `settlement.json` | rules paraphrases; partly original restructuring |

License reading (per the corrected acks-influence rationale, 2026-07-19):
as in-app content of an ACKS II App this is **permitted under App License
§2** — past releases are not violations and ip-scan rightly passes them. But
a public repo also serves these tables as raw JSON to people who never run
the app (Rule 1's "never publish the ACKS database separately" tension), and
the family's own stricter doctrine — *never ship a value read from a page*
(acks-content COOKBOOK.md principle 2) — now has working machinery behind
it: 4 shipped cookbooks, frozen executor, per-seat geometry extraction,
world persistence on import. The repo is currently **private** pending this
program.

## 2. Target architecture

```
acks-lib            + tables registry (priority: sample 0 < catalog 10 < world 20)
                    + services contract "ruledata-import" (write world tables)
   ▲ requires
acks-location (NEW) binding target for people/market/economy tables:
                    owns the table SCHEMAS (shapes, validation), registers
                    world-imported docs into acksLib.tables at priority 20,
                    "which tables are missing" UX, and the location actor
                    type (moved from henchmen). Future home of structures/
                    strongholds. Requires acks-lib only — no sibling edges.
acks-content        + cookbook `people`   (cultures/names/appearance RR 495–503
                      + BTA dwarven; occupations JJ 252–257 + BTA castes;
                      ages / proficiencies-by-age / hd0 / demographics /
                      class% JJ 245–253)
                    + cookbook `hirelings` (wages/morale/loyalty/officers
                      RR 166–173; availability + search fees RR 162–165;
                      rarity/commissioning JJ 118–119; class-distribution
                      double-d100 → Judges Screen Inserts; followers RR
                      334–337; slavery JJ 409–411; monstrous MM 351–352;
                      settlement RR 352)
                    + book registry: `bta` (ByThisAxe_digital), `js`
                      (Judges Screen Inserts) fingerprints
acks-henchmen       reads every table through acksLib.tables; ships NO
                    tables and NO samples; stub UX + import pointers when
                    absent; drops the location actor to acks-location.
```

Gating model: cookbook table entries ship as extraction **instructions**
(geometry + patterns), never values. A GM whose seat owns the book imports;
the materialized tables persist as **world data** registered at priority 20
— from then on the raw mechanics serve *everyone in that world*, bookless
seats included. Descriptive prose (culture descriptions, book text) never
persists — it stays seat-side, `@PdfText`-gated on the defining book.

The saved reference copies (`C:\Proj\acks-rules\acks-henchmen\
ruledata-reference\`, LOCAL-ONLY) are the authoring targets: verify replays
each recipe against the reference PDFs and must reproduce those tables.

## 3. What this does NOT cover

- **Pack compendia** (henchmen `proficiencies-powers`): App License
  §2-permitted; unshipped only when the acks-content ability-import path
  replaces them (the influence precedent, its 0.10.0) — replacement first,
  hygiene after. Not part of the immediate purge.
- **Automation vocabulary** stays code by rule (TOOLCHAIN ruledata design
  rule): flag keys, effect names, NAME_FALLBACKS regexes, outcome-effect
  enums. Only book-read values/structures move to extraction.
- Domain management / armies (out of module scope as before).

## 4. Rulings (owner, 2026-07-19)

1. **No fallback samples.** A world without an imported cookbook gets stubs
   + "import from your book" pointers. No SRD-safe sample tables ship.
2. **Location actor migrates to acks-location.** No backwards-compatibility
   or migration shims required.
3. **Back catalog: purge immediately.** ruledata saved locally for
   reference; `ruledata/` rewritten out of acks-henchmen git history; old
   releases/tags deleted; repo returns to public and releases resume on the
   clean tree. (Per the §2 reading this is hygiene + de-risking the public
   repo, not remediation.)

## 5. Execution phases

| # | Deliverable | Status |
| --- | --- | --- |
| 1 | Henchmen purge: save-local, untrack + tolerant loading, history rewrite, release/tag cleanup, re-release, repo public | executing 2026-07-19 |
| 2 | acks-lib: tables registry w/ priorities + `ruledata-import` contract | pending |
| 3 | acks-location scaffold: schemas, import registration, actor type | pending |
| 4 | `people` cookbook (authoring waves + chef audit per RECIPES.md) | pending |
| 5 | `hirelings` cookbook | pending |
| 6 | Henchmen consume release: registry reads, actor handoff, compendium unship | pending |

Standing follow-ups: Autarch **registration numbers** (Rule 2 placeholders
on every released module), `IP_GATE_TOKEN` secret still unset.
