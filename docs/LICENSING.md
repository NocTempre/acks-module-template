# ACKS Module Licensing & Disclaimer Rules

The ACKS modules are **ACKS II Apps** under the **ACKS II App License**. Two
obligations bind every module in this family; both are enforced by canonical
files so a module cannot quietly drift out of compliance.

> Source of truth: the *ACKS II App License Guide* (Autarch LLC). This doc is the
> family's operational reading of it — when the App License changes, change this
> doc first, then propagate (`bin/sync-toolchain.mjs`).

## Rule 1 — No module may claim a license that lets others take the code

The developer **owns** the original code; ACKS II material placed inside the app
is **not** open and does **not** transfer to the developer. Therefore:

- **No open-source or Open Game / community-use / compatibility license may ever
  be applied to the code.** No `MIT`, `GPL`, `Apache`, `CC-*`, "provided as-is",
  "public domain", or "free to reuse" wording. Those phrases are prohibited in
  `LICENSE`, `README`, `module.json`, and package metadata.
- The code is **proprietary, all rights reserved**, except the limited rights
  Autarch LLC holds under the App License (archive, preserve access, security /
  compatibility fixes, port, maintain-if-abandoned). Autarch may not appropriate
  and sell an **actively maintained** app; commercialization requires abandonment
  or the developer's written permission.
- Do **not** publish the ACKS database separately (no data dumps, bulk exports,
  public content APIs, downloadable embeddings, or reconstruction tools), and do
  **not** train/fine-tune models on ACKS material.

Enforced by the canonical **`LICENSE`** file (see below).

## Rule 2 — The mandatory disclaimers must be clear

Every module states, prominently, in its `README` "## License" section (and in
any in-app "about"/credits surface where practical):

1. **Unofficial** — not published or endorsed by Autarch LLC; the module's own
   name and developer identity stay more prominent than "ACKS II".
2. **Registration number** — assigned by Autarch at registration; it MUST appear
   before public release. Until assigned, carry the fill-in placeholder
   `_[pending registration]_` — never ship a released build without the real
   number.
3. **Required ACKS II publications** — name the book(s) the module needs; state
   that users must own them and the module is not a substitute.
4. **Free** — free to access and use; donations (if any) buy no advantage.
5. **Trademark** — ACKS, ACKS II, and Adventurer Conqueror King System are
   trademarks of Autarch LLC; ACKS II content is used under the ACKS II App
   License.

## How this is enforced (mechanism, not discipline)

- **`LICENSE`** is a **canonical `COPY` file** (`manifest.mjs`): byte-identical in
  every module and checked by `toolchain-check.yml` CI. A module that deletes it
  or swaps in a permissive license **fails CI**. It carries the code-ownership
  terms + the generic disclaimer, and points to the README for the two
  per-module variables (registration number, required publications) — those live
  in the README precisely because they must differ per module and so must **not**
  sit in the byte-identical file.
- **`README` "## License"** (module-owned, not synced) carries the per-module
  disclaimer: registration number, required publications, unofficial/free/
  trademark statements, and a link to `LICENSE`. The skeleton seeds the standard
  wording for new modules; keep existing modules matching it.
- **`module.json`** sets `"license": "LICENSE"` so Foundry surfaces it in the
  module browser.
- **New modules** get all of the above automatically (`bin/new-module.mjs` copies
  the skeleton). **Existing modules** receive `LICENSE` via
  `node bin/sync-toolchain.mjs --apply`; the README section and the `module.json`
  `license` field are updated per repo.

## Rule 3 — every publish passes an IP leak scan

Licensed ACKS II material must never reach a public repo or a release artifact.
`tools/ip-scan.mjs` is a canonical `COPY` file wired into `tools/validate.mjs`,
so it gates every `npm run validate` and therefore every release. CI runs it
**twice**: once against the tree, once against the *unpacked `module.zip`*, so
what actually ships is what gets checked.

What it flags:

- **Local-only rules extracts** (`RULES.md`, `PROFICIENCIES.md`,
  `*Reactions-Reference.md`) — these belong in `C:\Proj\acks-rules\<module-id>\`
  and were purged from every repo history 2026-07-16.
- **Extraction-pipeline state** (`_proposals/`, `_manifest/`, `_ledger.json`) —
  holds raw fragments lifted from the user's own PDFs.
- **Publisher attribution inside data files** — in a pack source or cookbook it
  means text was copied in wholesale rather than authored.
- **Warning only:** very long string leaves in data files, so transcribed prose
  gets a second look. Macro `command` bodies are exempt (authored JS).

It scans **git-tracked files** in a work tree and **everything** elsewhere. An
ignored, untracked file is not in the repo and never reaches the remote — the
extraction pipeline depends on that — but force-add one and it becomes tracked,
and the scan catches it. The file deliberately contains **no book text**: it
matches structural signals, never known passages, because storing those here
would itself be the leak.

### On a leak: quarantine, don't blockade

A tripped gate must never cost you work. The push has already landed and the
commit is safe on the remote; what gets withheld is **exposure** — the repo
drops to **private** and no release assets publish. Restore visibility
deliberately, after the leak is cleared.

> **Setup required:** this needs a PAT with `admin:repo` in the repo secret
> **`IP_GATE_TOKEN`**, because `GITHUB_TOKEN` cannot change repo visibility.
> Until that secret exists the release still **fails loudly** with manual
> instructions — it never passes silently — but you must take the repo private
> by hand.

See `docs/TOOLCHAIN.md` for the wider toolchain conventions.
