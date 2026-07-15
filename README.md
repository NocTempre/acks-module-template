# acks-module-template

Canonical toolchain and scaffold for the NocTempre family of ACKS II Foundry VTT
modules (`acks-equipment`, `acks-formation`, `acks-henchmen`, `acks-influence`,
`acks-monsters`, and future siblings).

This repo is the **single source of truth** for everything the modules share:
the release workflow, the pack build/validate harness, git dotfiles, and the
Claude Code infrastructure (CLAUDE.md, permission allowlist, skills). Modules
never redevelop these files — they receive them from here.

The ACKS **system** repo (`foundryvtt-acks-core`) is intentionally *not* a
target: it is an AutarchLLC fork with its own upstream-managed build and
release pipeline.

## Layout

| Path | Purpose |
| --- | --- |
| `skeleton/` | Complete module skeleton. Placeholder-bearing files (`{{MODULE_ID}}` …) are scaffold-only; the rest are the canonical synced files. |
| `manifest.mjs` | Declares which skeleton files are SYNCED into existing repos vs scaffold-only. |
| `bin/new-module.mjs` | Scaffold a new module repo from the skeleton. |
| `blank-template/` | Copy-me folder for starting a module by hand (copy → rename → `node INIT.mjs --title "..."`). Generated from `skeleton/` by `bin/make-blank.mjs` — never edit in place. |
| `bin/sync-toolchain.mjs` | Diff/apply canonical files into the existing module repos; installs the shared skills user-level. |
| `docs/TOOLCHAIN.md` | The canonical conventions — every "answer" the modules previously re-derived. |
| `.claude/skills/` | Shared skills: `acks-new-module`, `acks-release`, `acks-sync-toolchain`. |

## Usage

Scaffold a new module (creates `C:\Proj\<id>`, renders placeholders, `git init -b main`, first commit):

```
node bin/new-module.mjs acks-example --title "Example Feature" --desc "One-line description."
```

Check the existing modules for drift from canon (read-only):

```
node bin/sync-toolchain.mjs --check
```

Apply canon to all clean repos (repos with uncommitted changes are skipped):

```
node bin/sync-toolchain.mjs --apply
```

Install/update the shared Claude skills into `~/.claude/skills` so they are
available in every session regardless of working directory:

```
node bin/sync-toolchain.mjs --install-skills
```

## Changing a canonical file

1. Edit it in `skeleton/` here (never in a module repo — sync will overwrite).
2. `node bin/sync-toolchain.mjs --apply` and `node bin/make-blank.mjs`
3. In each module: `npm run build:packs && npm run validate`, then commit.

See [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md) for the full conventions.
