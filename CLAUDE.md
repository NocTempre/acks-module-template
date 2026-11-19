# acks-module-template (retired)

**Retired 2026-11-18. Do not edit, commit or push here.** The toolchain this
repo distributed was folded into `C:\Proj\foundryvtt-acks-extras` at its commit
`22cc1101`, and that repo is where it is edited: `.claude/` (skills, rules,
hooks, agents), `tools/` (validate, the IP scan, the release preflight and
their suites under `tools/toolchain-tests/`), `.github/workflows/` and
`docs/TOOLCHAIN.md`.

- Nothing here is synced anywhere. `bin/sync-toolchain.mjs`,
  `bin/new-module.mjs`, `skeleton/` and `manifest.mjs` are history; do not run
  them against another repo.
- A task that names a file here means its copy in `foundryvtt-acks-extras`.
- `docs/DECISIONS.md` is the archive that repo's DECISIONS index links to. Read
  it for why a rule exists; write new rulings in that repo.
