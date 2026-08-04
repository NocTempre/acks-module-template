# ACKS II — {{MODULE_TITLE}}

{{MODULE_DESCRIPTION}}

A Foundry VTT module that extends the
[ACKS II game system](https://github.com/AutarchLLC/foundryvtt-acks-core).

## Installation

In Foundry: **Install Module** → paste the manifest URL:

```
https://github.com/NocTempre/{{MODULE_ID}}/releases/latest/download/module.json
```

## Requirements

- Foundry VTT v14+
- ACKS II system (`acks`) v14+

## Getting started (GM workflow)

<!-- TOOLCHAIN.md §10f: this section is REQUIRED before first release.
     Numbered steps from an empty world to the feature visibly working,
     naming the exact macros/compendia involved. acks-extras' README is
     the pattern. -->

1. _[step one: what the GM creates/enables first]_
2. _[step two: the action that makes the module do something visible]_

## Disabling & uninstalling

<!-- TOOLCHAIN.md §10d: if the module persists flags/Active Effects on world
     documents, name the strip tool here. If it depends on a module that owns
     document sub-types (acks-extras does), note that Foundry's dependency
     dialog pre-checks that module for deactivation, which makes those
     documents unavailable until re-enabled. Delete the section only if the
     module writes nothing. -->

## Development

```
npm install
npm run build:packs   # regenerate packs/_source from tools/pack-data.mjs, then compile
npm run validate      # syntax / templates / JSON / packs / i18n / IP checks
```

Run `build:packs` after cloning or the compendia are empty — the compiled packs
are gitignored build output, not source.

Releases are cut by pushing a `v<version>` tag matching `module.json`; GitHub
Actions builds and publishes `module.zip` + `module.json`.

This repo follows the shared ACKS module toolchain — see
`acks-module-template/docs/TOOLCHAIN.md` for conventions.

## License

**Code:** © NocTempre — proprietary; all rights reserved except as granted to
Autarch LLC under the **ACKS II App License**. This module is **not** open source
or Open Game Content, and no license is granted to copy, redistribute, or reuse
its code. See [`LICENSE`](LICENSE).

**ACKS II content** is used under the **ACKS II App License**. ACKS, ACKS II, and
Adventurer Conqueror King System are trademarks of **Autarch LLC**.

**Unofficial** — this is an unofficial fan module, not published or endorsed by
Autarch LLC.

**Registration #:** _[pending registration]_

**Requires:** Adventurer Conqueror King System II (ACKS II) _[name the specific
publication(s) this module needs]_. You must own them; this module is not a
substitute for the books and is free to use.
