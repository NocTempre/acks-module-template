---
name: acks-release
description: Cut a release of an ACKS module repo (version bump, tag, CI watch, manifest verification). Use when the user asks to release/publish/tag an acks-* module.
---

Release procedure for any NocTempre `acks-*` module (canonical definition:
`C:\Proj\acks-module-template\docs\TOOLCHAIN.md` §4). Work inside the module
repo; confirm with the user which repo and what version bump (patch/minor)
if not stated.

The CI procedure itself lives in acks-module-template's
`release-module.yml` (reusable workflow) — module `release.yml` files are thin
synced callers; never edit either in a module repo. A pre-flight dry run of
the full pipeline (build + validate, no publish) is available anytime:
`gh workflow run Release --repo NocTempre/<id> --ref main`

1. Preflight: working tree clean (or only the changes being released);
   `git log origin/<branch>..HEAD` to know what's going out.
2. Bump `version` in `module.json` (plain semver X.Y.Z). Update `CHANGELOG.md`
   if the repo has one.
3. `npm run build:packs`. Then check `git status packs/`:
   - `packs/_source` unchanged → the LevelDB diff is timestamp churn:
     `git restore packs/ && git clean -fd packs/`.
   - `packs/_source` changed → commit both `_source` and compiled packs.
4. `npm run validate` and, if a `test` script exists, `npm test`. Both must
   pass — fix, don't skip.
5. Commit, then tag exactly `v<module.json version>` and push branch + tag:
   `git tag v<X.Y.Z> && git push origin <branch> --tags`
   (CI fails the release if tag and manifest version differ.)
6. Confirm the release published — **bounded checks only, never
   `gh run watch`** (it blocks forever through GitHub API outages, which
   happen; 2026-07-16 stranded several agents this way). Poll with your
   harness's non-blocking waiting (background until-loop or Monitor with a
   timeout), checking `gh release view v<X.Y.Z> --json assets` every ~30s
   for at most ~5 minutes. The workflow itself takes ~30s when healthy.
   - If the API returns 5xx: GitHub is down, not the release. The tag is
     pushed; CI fires or finishes on its own. Report "published pending
     API recovery" and STOP — do not wait out an outage.
   - If the run genuinely failed: read the log, fix, delete the tag
     locally+remotely only if the release never published, and retry.
7. Verify the manifest resolves with the new version (bounded, `-m 15`):
   `curl -sm 15 -L https://github.com/NocTempre/<id>/releases/latest/download/module.json`
   While the repos are PRIVATE this 404s unauthenticated by design — use
   `gh release view` instead and note the limitation in your report.
8. Report: version, release URL, and anything skipped.

Never force-push tags over a published release; cut a new patch version
instead.
