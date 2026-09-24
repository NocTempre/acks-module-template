# acks-module-template

Canonical toolchain and scaffold for the NocTempre family of ACKS II Foundry VTT
modules — today `acks-extras` (merged rules automation, the book-content
importer included), plus whatever is scaffolded next.

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
| `skeleton/` | Complete module skeleton. |
| `manifest.mjs` | Declares which skeleton files are SYNCED into existing repos vs scaffold-only. |
| `bin/new-module.mjs` | Scaffold a new module repo from the skeleton. |
| `blank-template/` | Copy-me folder for starting a module by hand (copy → rename → `node INIT.mjs --title "..."`). Generated from `skeleton/` by `bin/make-blank.mjs` — never edit in place. |
| `bin/sync-toolchain.mjs` | Diff/apply canonical files into the existing module repos. |
| `bin/test-validate.mjs` | Runs the canonical `validate.mjs` over invented modules its gates must fail or pass. Run after editing it; template CI runs it too. |
| `docs/TOOLCHAIN.md` | The canonical conventions — every "answer" the modules previously re-derived. Start here. |
| `docs/DECISIONS.md` | Dated family-level rulings: why the conventions are these, what was tried and abandoned. Read before a structural change. |
| `docs/LICENSING.md` | ACKS II App License obligations and the IP-leak gate. |
| `.claude/skills/` | Shared skills, one subdirectory each; the directory listing is the roster. |

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

## Changing a canonical file

Follow the [`/acks-sync-toolchain`](.claude/skills/acks-sync-toolchain/SKILL.md)
skill. [TOOLCHAIN §9](docs/TOOLCHAIN.md) sets the push order between this repo
and the module repos; read it before pushing either.

See [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md) for the full conventions.
