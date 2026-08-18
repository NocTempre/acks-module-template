# acks-module-template

Canonical source of the ACKS module family's shared toolchain, agent
infrastructure and conventions. **Highest blast radius in the family**: what is
edited here propagates into every module repo, and a mis-sequenced push reddens
every downstream CI at once. Read `docs/TOOLCHAIN.md` before changing anything;
`docs/DECISIONS.md` records why things are the way they are.

## Layout

- `skeleton/` — canonical files synced into module repos, plus scaffold for new
  ones. `manifest.mjs` declares how each file participates (COPY / APPEND_OK /
  COPY_IF_PACK_DATA / RENDER / package.json MERGE) — a skeleton file NOT in the
  manifest seeds new modules only and never pushes into existing ones.
- `.claude/skills/` — the family skills, **canonical here** (COPY_DIRS): synced
  recursively into each module repo's `.claude/skills/` and CI-gated there.
  There is no user-level install; a `~/.claude/skills/acks-*` copy is a drift
  hazard — delete it on sight.
- `bin/` — dev harness: `sync-toolchain.mjs` (drift check + apply),
  `new-module.mjs` (scaffold), capture/test drivers.
- `blank-template/` — frozen empty-module snapshot for manual scaffolding.
- `docs/` — TOOLCHAIN.md (the family contract), DECISIONS.md (dated rulings,
  append-only), LICENSING.md. Not shipped anywhere.

## Rules

- **Single branch `main`, no worktrees** — enforced by
  `.claude/hooks/single-branch-guard.mjs`, same as every module repo.
- **Push ordering: template first.** Module-repo CI checks out this repo's
  `main`; syncing modules before pushing the template edit they depend on turns
  every downstream toolchain-check red (TOOLCHAIN §9).
- After editing anything canonical: `node bin/sync-toolchain.mjs --check`, fix
  drift with `--apply` (never by hand-editing the copies in module repos),
  commit template, push, then commit + push the synced repos.
- `skeleton/CLAUDE.md` renders into every module repo — edits there speak to
  every future session in the family. Keep it lean; put procedures in skills
  and reference in TOOLCHAIN.
- This repo has no packs, no module.json, no releases — nothing here ships to
  users directly.
