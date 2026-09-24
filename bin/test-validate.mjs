/**
 * Feeds the canonical validator invented modules and checks that it fails what
 * it exists to catch, and passes what a module legitimately writes. Each case
 * is a throwaway module — a few invented files plus skeleton/tools/validate.mjs
 * — and the validator runs inside it exactly as `npm run validate` runs it.
 *
 * validate.mjs imports `handlebars`, and this repo installs nothing (it has no
 * package.json), so the fixtures borrow an installed copy through a link to a
 * node_modules directory: the argument when one is given (template CI passes
 * its scaffolded smoke module's), otherwise the first manifest DEFAULT_TARGETS
 * repo beside this one that has one. The borrowed tree is only read, and the
 * link is removed before the fixtures are.
 *
 * Usage:  node bin/test-validate.mjs [<node_modules dir>]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { DEFAULT_TARGETS } from "../manifest.mjs";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const VALIDATOR = path.join(TEMPLATE_ROOT, "skeleton", "tools", "validate.mjs");

const candidates = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : DEFAULT_TARGETS.map((repo) => path.join(TEMPLATE_ROOT, "..", repo, "node_modules"));
const nodeModules = candidates.find((dir) => fs.existsSync(path.join(dir, "handlebars", "package.json")));
if (!nodeModules) {
  console.error(`test-validate: no handlebars install in ${candidates.join(", ")} — pass a node_modules directory that holds one`);
  process.exit(1);
}

// Every fixture is a module the validator has nothing else to say about, so a
// case's FAIL lines are its subject's alone.
const BASE = {
  "module.json": JSON.stringify({ id: "acks-fixture", version: "0.1.0", compatibility: { minimum: "14" }, esmodules: ["scripts/module.mjs"] }, null, 2),
  "package.json": JSON.stringify({ name: "acks-fixture", private: true, type: "module" }, null, 2),
  "scripts/module.mjs": 'export const MODULE_ID = "acks-fixture";\n',
};

// Every registration shape the reader accepts, beside every shape it must not
// mistake for one: a name in a comment, in a string, one level down in a
// nested object, and a method that merely shares the name. The regex holds a
// quote and a brace ahead of a key the templates call, so a tokenizer that
// misread it would lose that key.
const REGISTRATIONS = `const NAMED = "acksFixtureNamed";
const TABLED = {
  acksFixtureTabled: (label) => String(label),
};
const MENTION = "Handlebars.registerHelper('acksFixtureInString', () => '')";

class Registry {
  registerHelper(name, fn) {
    this[name] = fn;
  }
}

Hooks.once("init", () => {
  Handlebars.registerHelper("acksFixtureShout", (s) => String(s).toUpperCase());
  Handlebars.registerHelper({
    acksFixtureEscape(s) {
      return String(s).replace(/["{]/g, "");
    },
    // acksFixtureInComment is only mentioned here, so it registers nothing
    acksFixtureWhisper: (s) => \`\${String(s).toLowerCase()}\`,
    acksFixtureNested: { first: 1, acksFixtureDeepKey: () => "" },
  });
  Handlebars.registerHelper(NAMED, (v) => v);
  Handlebars.registerHelper(TABLED);
});
`;

const CASES = [
  {
    name: "a helper nothing registers, called with an argument, fails at its line",
    files: {
      "templates/roll-dialog.hbs": `<select name="mode">
  <option value="once" {{selected (not perTarget)}}>Once</option>
  <option value="each" {{selected perTarget}}>Each</option>
</select>
`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/roll-dialog\.hbs: line 2: \{\{selected .*throws "Missing helper: selected"/,
      /^FAIL templates\/roll-dialog\.hbs: line 3: \{\{selected /,
    ],
    out: [/validate: helpers checked 3 calls to 2 distinct helpers across 1 template,/],
  },
  {
    name: "the same call passes under a declared escape",
    files: {
      "templates/roll-dialog.hbs": `<select name="mode">
  {{!-- helper-ok: registered by a module this one requires --}}
  <option value="once" {{selected (not perTarget)}}>Once</option>
</select>
`,
    },
    exit: 0,
    out: [/validate: helpers checked 2 calls to 2 distinct helpers across 1 template,/],
  },
  {
    name: "core helpers, registered helpers, lookups, block params and context calls pass",
    files: {
      "scripts/module.mjs": REGISTRATIONS,
      "templates/sheet.hbs": `<form class="acks-fixture-sheet">
  <h2>{{localize "ACKS-FIXTURE.title"}}</h2>
  {{#if flags.open}}
    <p>{{acksFixtureShout name}}</p>
  {{else if flags.closed}}
    <p>{{acksFixtureWhisper name}}</p>
  {{else}}
    <p>{{selected}}</p>
  {{/if}}
  <select name="pick">{{selectOptions choices selected=pick localize=true}}</select>
  <input type="checkbox" name="on" {{checked on}}>
  {{#each rows as |row|}}
    <span>{{acksFixtureTabled row.label}} {{row 1}}</span>
  {{/each}}
  <span>{{acksFixtureNamed (concat "a" (acksFixtureEscape b))}}</span>
  <span>{{this.format total}} {{@root.partId}}</span>
  {{#*inline "cell"}}<td>{{value}}</td>{{/inline}}
  {{> cell value=(eq a b)}}
  {{#with totals as |t|}}{{t.sum}}{{/with}}
</form>
`,
    },
    exit: 0,
    out: [
      /validate: helpers checked 14 calls to 13 distinct helpers across 1 template, against Foundry [\d.]+ core \(\d+\) \+ 6 registered in scripts\/; 1 call on a context path/,
    ],
    absent: [/^WARN /m],
  },
  {
    name: "names in comments, strings, nested objects and test harnesses register nothing",
    files: {
      "scripts/module.mjs": REGISTRATIONS,
      "tools/test-fixture.mjs": `Handlebars.registerHelper("acksFixtureMock", () => "");\n`,
      "templates/sheet.hbs": `<p>{{acksFixtureInComment 1}}</p>
<p>{{acksFixtureInString 1}}</p>
<p>{{acksFixtureDeepKey 1}}</p>
<p>{{acksFixtureMock 1}}</p>
`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/sheet\.hbs: line 1: \{\{acksFixtureInComment /,
      /^FAIL templates\/sheet\.hbs: line 2: \{\{acksFixtureInString /,
      /^FAIL templates\/sheet\.hbs: line 3: \{\{acksFixtureDeepKey /,
      /^FAIL templates\/sheet\.hbs: line 4: \{\{acksFixtureMock /,
    ],
  },
  {
    name: "a call with no positional argument fails, and says it renders nothing",
    files: {
      "templates/sheet.hbs": `<p>{{acksFixtureGone key=1}}</p>
{{#if (acksFixtureAlsoGone)}}<p>x</p>{{/if}}
`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/sheet\.hbs: line 1: \{\{acksFixtureGone .*renders nothing, silently/,
      /^FAIL templates\/sheet\.hbs: line 2: \(acksFixtureAlsoGone .*renders nothing, silently/,
    ],
  },
  {
    name: "a block with no arguments fails unless a helper of that name is registered",
    files: {
      "templates/list.hbs": `<ul>
  {{#rows}}<li>{{this}}</li>{{/rows}}
</ul>
`,
    },
    exit: 1,
    fails: [/^FAIL templates\/list\.hbs: line 2: \{\{#rows\}\}.*a section over the context property "rows"/],
  },
  {
    name: "a registration whose name cannot be read is reported, and a call to it points back",
    files: {
      "scripts/module.mjs": `const HELPERS = globalThis.acksFixtureHelpers ?? {};
for (const [name, fn] of Object.entries(HELPERS)) Handlebars.registerHelper(name, fn);
Handlebars.registerHelper("acksFixture" + "Joined", () => "");
`,
      "templates/sheet.hbs": `<p>{{acksFixtureJoined 1}}</p>\n`,
    },
    exit: 1,
    fails: [/^FAIL templates\/sheet\.hbs: line 1: \{\{acksFixtureJoined .*\(2 registerHelper calls in scripts\/ could not be read/],
    out: [
      /WARN scripts\/module\.mjs:2: registerHelper call whose helper name this check cannot read/,
      /WARN scripts\/module\.mjs:3: registerHelper call whose helper name this check cannot read/,
    ],
  },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-validate-"));
const link = path.join(tmp, "node_modules");
let failures = 0;
try {
  fs.symlinkSync(nodeModules, link, "junction");
  CASES.forEach((testCase, n) => {
    // The directory is named for the module id, as validate.mjs expects.
    const root = path.join(tmp, String(n), "acks-fixture");
    for (const [rel, text] of Object.entries({ ...BASE, ...testCase.files })) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    fs.mkdirSync(path.join(root, "tools"), { recursive: true });
    fs.copyFileSync(VALIDATOR, path.join(root, "tools", "validate.mjs"));

    const run = spawnSync(process.execPath, [path.join(root, "tools", "validate.mjs")], { encoding: "utf8" });
    const output = `${run.stdout}${run.stderr}`;
    const failLines = output.split(/\r?\n/).filter((line) => line.startsWith("FAIL "));
    const problems = [];
    if (run.status !== testCase.exit) problems.push(`exit ${run.status}, expected ${testCase.exit}`);
    for (const re of testCase.fails ?? []) if (!failLines.some((line) => re.test(line))) problems.push(`no FAIL line matches ${re}`);
    for (const line of failLines) if (!(testCase.fails ?? []).some((re) => re.test(line))) problems.push(`unexpected ${line}`);
    for (const re of testCase.out ?? []) if (!re.test(output)) problems.push(`output lacks ${re}`);
    for (const re of testCase.absent ?? []) if (re.test(output)) problems.push(`output carries ${re}`);

    if (problems.length) {
      failures++;
      console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}\n  --- validator output ---\n${output.replace(/^/gm, "  | ")}`);
    } else console.log(`ok   ${testCase.name}`);
  });
} finally {
  try {
    fs.unlinkSync(link);
  } catch {
    /* never created */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!fs.existsSync(path.join(nodeModules, "handlebars", "package.json"))) {
  console.error(`test-validate: ${nodeModules} lost its handlebars install during cleanup — the link was followed`);
  process.exit(1);
}
console.log(`test-validate: ${CASES.length} case${CASES.length === 1 ? "" : "s"}, ${failures} failed`);
if (failures) process.exit(1);
