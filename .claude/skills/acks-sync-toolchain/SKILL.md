---
name: acks-sync-toolchain
description: Propagate canonical toolchain files from acks-module-template into the acks-* module repos and verify each. Use after editing the template, or to audit repos for drift.
---

The template repo `C:\Proj\acks-module-template` is the single source of truth
for the files listed in its `manifest.mjs` (release workflow, validate/build
harness, dotfiles, CLAUDE.md, Claude settings). Never edit those files inside a
module repo — edit the skeleton in the template, then sync.

1. Audit first:
   `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --check`
   Summarize the drift per repo for the user.
2. Apply: `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --apply`
   Repos with uncommitted changes are skipped automatically — leave them; note
   them in your summary rather than using `--force`.
3. Verify every repo that received changes:
   - `npm install` if package.json changed, then
     `npm run build:packs && npm run validate` (and `npm test` if present).
   - If `packs/_source` is unchanged, discard LevelDB timestamp churn:
     `git restore packs/ && git clean -fd packs/`.
   - If validate fails because the *canonical* file is wrong for a legitimate
     case, fix it in the template skeleton and re-sync everywhere — never fork
     a per-repo copy.
4. Commit in each changed repo:
   `chore: sync toolchain from acks-module-template` (do not push unless the
   user asks).
5. If skills changed in the template, refresh the user-level installs:
   `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --install-skills`
6. If the skeleton changed, regenerate the copy-me folder:
   `node C:\Proj\acks-module-template\bin\make-blank.mjs`
7. Commit the template repo itself if anything changed.
