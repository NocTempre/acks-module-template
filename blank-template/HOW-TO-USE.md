# Starting a new module from this folder

1. Copy this whole folder to `C:\Proj\<your-module-id>` (lowercase kebab,
   `acks-` prefix) — the folder name becomes the module id.
2. In the copy, run: `node INIT.mjs --title "Feature Name" --desc "One-liner."`
   This renders every placeholder, creates the git repo on `main` with a
   first commit, and deletes INIT.mjs and this file.
3. `npm install && npm run validate`

Equivalent one-step alternative:
`node C:\Proj\acks-module-template\bin\new-module.mjs <id> --title "..." --desc "..."`

This folder is generated from `skeleton/` by `bin/make-blank.mjs` — do not
edit it in place.
