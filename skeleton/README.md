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

## Development

```
npm install
npm run build:packs   # rebuild compendium packs from packs/_source
npm run validate      # syntax / templates / JSON / packs / i18n checks
```

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
