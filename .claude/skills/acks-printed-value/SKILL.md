---
name: acks-printed-value
description: Move a printed value out of acks-extras source and onto the importer — a figure off the page (a modifier, rate, price, band edge, ladder rung, day length) that code reads as a literal or a frozen table. Use when a session finds one, when a ROADMAP "printed values in code" row is picked up, or when a feature needs a number only the book prints. Not for importing names, prose or whole entries (docs/importer/RECIPES.md), and not for looking a rule up (rules-lookup.md, shelf-extract).
---

The rule is `.claude/rules/ip-doctrine.md`, "A printed value found in source is
fixed by the work that finds it". This skill routes the work and says what
done is; the file headers it names are the reference for how, and nothing
here restates them. Paths are `foundryvtt-acks-extras`'. The importer and the
registry live there and nowhere else: a printed value found in another repo
goes on that repo's ROADMAP for the owner, with no route invented for it.

## 1. Before touching it

- **Whose file is it?** A file another session has in flight gets the finding
  sent to that session, not an edit (doctrine).
- **Read the consumer first.** The read must hand it exactly the shape it uses
  (a number, a band, a ladder, a `quantity`) or nothing at all.
- **Confirm the figure against the page**, cheapest source first
  (`rules-lookup.md`; `shelf-extract` where the shelf has to be read). What
  you learn stays local: the number never enters a commit, a test, a comment,
  a commit message or a report.

## 2. Route by how the page prints it

| The page prints it as | It is read by | Reference |
| --- | --- | --- |
| a grid: labelled rows, cells in columns | a recipe in `TABLE_RECIPES` | `scripts/importer/table-recipes.mjs` header; cell patterns in `table-extract.mjs` |
| a figure inside sentences | a binding that assembles an engine table from raw reads and exports `PRODUCES` | `scripts/importer/light-binding.mjs` (the model) and `produces.mjs` |
| a thing's own passage stating what it is (a weight, an armour class) | a `values` spec on its register entry | `docs/importer/COOKBOOK.md`, "`values`" |

Grid and prose reads land as a ruledata document in the layered registry
(`scripts/lib/tables.mjs` header, `docs/lib/API.md` "`tables`"). The consumer
declares what it reads with `expectTables` and gates every read on it being
there.

## 3. Done is all of these

1. **The importer reads it** from the seat's own book at import. Source holds
   geometry, anchors and label patterns, never the figure.
2. **A Judge can edit it.** A registry table has this already: the Ruledata
   Browser's override layer (`scripts/location/ruledata-browser.mjs`). A value
   outside the registry needs the feature's own form.
3. **Nothing imported, nothing shown.** The surface says "not imported" (a
   lang key) and shows no figure in its place. A half-matched read counts as
   none. The consumer answers null; it never falls back to the old literal.
4. **Its tooltip says where it came from** (`ui-tooltips.md`): `citeOf` names
   the page; where `citeOf` is null the tooltip says the override or "not
   imported".
5. **The literal is gone**: the constant, its sample row, and any comment
   that restated it. The page reference stays (doctrine, "What a citation
   does not do").
6. **Tests, offline.**
   - Removing the literal breaks every test that asserted it, and that
     failure is correct. Each such test registers its own ruledata with
     INVENTED figures; `tools/test-light-binding.mjs` (prose) and
     `tools/importer/test-grid-rows.mjs` (a shipped recipe on invented page
     runs laid out as the book sets them) are the patterns. A real figure
     sits only in the gitignored `tools/rules-tests/`.
   - A new recipe is covered by `test-recipe-pages.mjs` (its folio) and
     `test-recipe-content.mjs` (its shape against this machine's books).
     Both assert structure only and skip without the books.
   - Where the WIKI-SNAPSHOT covers the book, the read is checked against it,
     and the result is quoted as counts ("6 of 6 rows agree"), never values.
   - `npm run validate` runs `tools/validate-producers.mjs`: a table a
     feature reads has something that writes it.
7. **Live** (`live-testing.md`), on a GM seat with the book connected: the
   import reads the figure and the consumer acts on it; with the book closed
   or the table absent the surface says not imported; an override set in the
   Ruledata Browser wins and reverts. The walk goes into the feature's
   `TESTING.md`.
8. **Docs** (`docs-doctrine.md`): the feature's `MODEL.md` says what it reads,
   from which page, and what it does without it; `docs/importer/MODEL.md`
   gains a line where the read is a new kind; the ROADMAP row is deleted in
   the same commit. A `DECISIONS.md` entry only where something was ruled.
   The commit message carries counts and page references, no values.

## When it cannot be done as written

- **The page prints no figure for a case the code covered.** That case
  answers null and the surface says so; the gap is reported, never filled
  with a default.
- **No page prints the number at all.** Whether it is structural or printed
  is a doctrine call, and it goes to the owner with the search that was made.
  It is never delegated (`delegation.md`, Tier C).
- **The read cannot be made reliable on this machine's printing.** The
  literal still goes. The consumer declares its table, so the Judge has an
  empty placeholder to fill by hand (`expectTables`), the surface says not
  imported until then, and the ROADMAP row now names the missing read, with
  what the attempt found.
