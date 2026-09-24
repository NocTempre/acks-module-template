/**
 * Feeds the canonical IP scanner invented sources and checks that its
 * long-literal warning measures literals: that it fires on a long string or
 * template wherever one sits, and never on a comment or regex that happens to
 * lie between two quote marks. Each case is a throwaway tree of invented files
 * scanned through `scanPaths`, the entry the pre-commit hook uses.
 *
 * Usage:  node bin/test-ip-scan.mjs [<ip-scan.mjs>]
 *         (defaults to skeleton/tools/ip-scan.mjs; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const SCANNER = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "skeleton", "tools", "ip-scan.mjs"));
const { scanPaths } = await import(url.pathToFileURL(SCANNER).href);

// Invented text, longer than the scanner's 1500-character threshold.
const PROSE = "An invented sentence standing in for a paragraph someone pasted. ".repeat(26);
const HALF = PROSE.slice(0, 800);
const FILLER = Array.from({ length: 40 }, (_, n) => `export const filler${n} = ${n}; // ${"-".repeat(60)}\n`).join("");
// The notice is assembled so this file never holds one: bin/ is outside the
// scanned globs, and it stays out of every grep for the phrase as well.
const NOTICE = ["All", "rights", "reserved."].join(" ");

const CASES = [
  {
    name: "a backtick in a comment or a regex opens no literal",
    files: {
      "scripts/module.mjs": `// A lone \` in a comment opens nothing, and the one in the regex below
// closes nothing: pairing quote marks would read 3,000 characters between.
${FILLER}const TICKS = /[\`'"]/g;
export const tidy = (s) => s.replace(TICKS, "");
`,
    },
    warnings: [],
  },
  {
    name: "a long string, template, or template with holes warns at its own line",
    files: {
      "scripts/texts.mjs": `export const A = "${PROSE}";
export const B = \`
${PROSE}
\`;
export const C = (x) => \`${HALF}\${x}${HALF}\`;
`,
    },
    warnings: [
      /^scripts\/texts\.mjs: line 1: a 1692-char string literal — verify this is authored, not transcribed$/,
      /^scripts\/texts\.mjs: line 2: a 1694-char string literal/,
      /^scripts\/texts\.mjs: line 5: a 1602-char string literal/,
    ],
  },
  {
    name: "a template counts its own text; a literal in its holes is measured alone",
    files: {
      "scripts/card.mjs": `export const card = (a) => \`<p>\${[${Array.from({ length: 300 }, (_, n) => `a.v${n}`).join(", ")}].join(" ")}</p>\`;
export const note = (on) => \`<p>\${on ? "${PROSE}" : ""}</p>\`;
`,
    },
    warnings: [/^scripts\/card\.mjs: line 2: a 1692-char string literal/],
  },
  {
    name: "a literal after a regex holding a backtick is still found",
    files: {
      "tools/quotes.mjs": `const QUOTES = /["'\`]/g;
export const A = \`${PROSE}\`;
// a closing \` in a comment
`,
    },
    warnings: [/^tools\/quotes\.mjs: line 2: a 1692-char string literal/],
  },
  {
    name: "a file the tokenizer cannot read is measured by quote pairing, and says so",
    files: {
      "scripts/broken.mjs": `export const broken = (1));
export const A = "${PROSE}";
`,
    },
    warnings: [
      /^scripts\/broken\.mjs: line 1: the literal scan lost its place here, so this file's literals were measured by pairing quote marks/,
      /^scripts\/broken\.mjs: line 2: a 1692-char string literal/,
    ],
  },
  {
    name: "a copyright notice in source still fails, in a comment as anywhere",
    files: { "tools/helper.mjs": `// ${NOTICE}\nexport const x = 1;\n` },
    warnings: [],
    errors: [/^tools\/helper\.mjs — publisher attribution in source/],
  },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-ip-scan-"));
let failures = 0;
try {
  CASES.forEach((testCase, n) => {
    const root = path.join(tmp, String(n));
    for (const [rel, text] of Object.entries(testCase.files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const { errors, warnings } = scanPaths(root, Object.keys(testCase.files));
    const problems = [];
    for (const [kind, lines, expected] of [
      ["warning", warnings, testCase.warnings],
      ["error", errors, testCase.errors ?? []],
    ]) {
      for (const re of expected) if (!lines.some((line) => re.test(line))) problems.push(`no ${kind} matches ${re}`);
      for (const line of lines) if (!expected.some((re) => re.test(line))) problems.push(`unexpected ${kind}: ${line}`);
    }
    if (problems.length) {
      failures++;
      console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}`);
    } else console.log(`ok   ${testCase.name}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const shown = path.relative(TEMPLATE_ROOT, SCANNER);
console.log(`test-ip-scan: ${CASES.length} cases against ${shown.startsWith("..") ? SCANNER : shown}, ${failures} failed`);
if (failures) process.exit(1);
