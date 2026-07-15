/**
 * Regenerate blank-template/ — the copy-me folder for starting a new module by
 * hand — from skeleton/ plus bin/blank-init.mjs (shipped as INIT.mjs).
 *
 * blank-template/ is a build artifact: never edit it directly; edit skeleton/
 * and re-run this. Run it after any skeleton change (the acks-sync-toolchain
 * skill includes this step).
 *
 * Usage:  node bin/make-blank.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const SKELETON = path.join(TEMPLATE_ROOT, "skeleton");
const BLANK = path.join(TEMPLATE_ROOT, "blank-template");

fs.rmSync(BLANK, { recursive: true, force: true });
fs.cpSync(SKELETON, BLANK, { recursive: true });
fs.copyFileSync(path.join(TEMPLATE_ROOT, "bin", "blank-init.mjs"), path.join(BLANK, "INIT.mjs"));
fs.writeFileSync(
  path.join(BLANK, "HOW-TO-USE.md"),
  `# Starting a new module from this folder

1. Copy this whole folder to \`C:\\Proj\\<your-module-id>\` (lowercase kebab,
   \`acks-\` prefix) — the folder name becomes the module id.
2. In the copy, run: \`node INIT.mjs --title "Feature Name" --desc "One-liner."\`
   This renders every placeholder, creates the git repo on \`main\` with a
   first commit, and deletes INIT.mjs and this file.
3. \`npm install && npm run validate\`

Equivalent one-step alternative:
\`node C:\\Proj\\acks-module-template\\bin\\new-module.mjs <id> --title "..." --desc "..."\`

This folder is generated from \`skeleton/\` by \`bin/make-blank.mjs\` — do not
edit it in place.
`,
);
console.log(`regenerated ${BLANK}`);
