/**
 * Drives the capture driver's page keeper, its stray-page rule and its
 * DevTools connection against scripted stand-ins, and checks what a long shot
 * run depends on: that the page is put back in front before its windows are
 * closed or a frame is taken, that no close waits on an animation, that a
 * toast cannot be in the frame, and that a capture nothing answers is given
 * up and tried once more. The scripted page runs the driver's own page-side
 * expressions, in a `vm` context holding the few DOM and Foundry members they
 * touch, so an expression that does not parse fails here.
 *
 * Nothing here launches a browser: what a real page does when it is hidden is
 * outside this file, and only a live run shows it.
 *
 * Usage:  node bin/test-foundry-capture.mjs [<foundry-capture.mjs>]
 *         (defaults to bin/foundry-capture.mjs; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import path from "node:path";
import url from "node:url";
import vm from "node:vm";

const TEMPLATE_ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const DRIVER = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "bin", "foundry-capture.mjs"));
const { Cdp, pageKeeper, strayPages } = await import(url.pathToFileURL(DRIVER).href);

const OWN = "target-own";
const TRAY = "#notifications";
const PNG = "iVBORw0KGgo=";
const UNANSWERED = "timeout: Page.captureScreenshot";

// Invented targets: the two a browser opened for itself, and the ones it did not.
const DIALOG = { targetId: "t-dialog", type: "page", url: "edge://sync-confirmation-dialog/" };
const FIRST_RUN = { targetId: "t-first-run", type: "page", url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/first-run.html" };
const BLANK = { targetId: "t-blank", type: "page", url: "about:blank" };
const POPOUT = { targetId: "t-popout", type: "page", url: "https://world.invalid/popout" };
const WORKER = { targetId: "t-worker", type: "service_worker", url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js" };

/**
 * A scripted page and the three channels `pageKeeper` drives it through.
 * `visibility` and `frames` say whether it starts hidden and whether it paints;
 * `pages` are the browser's other targets (one marked `stays` survives its
 * close); `captures` are the outcomes of successive screenshots, "ok" or an
 * error message, "ok" once they run out; `refuse` names commands the browser
 * rejects; `fronting` is what activating a hidden page does — it "shows" at
 * once, "lags" a moment behind the command's reply, or stays "stuck" hidden;
 * `evaluateFails(expression, page)` picks page-side expressions that never
 * answer; `apps` are its open applications (`{id, name}`, one marked `throws`
 * refuses to close) and `toasts` how many sit in its tray. The returned object
 * records every call in order, the stylesheets in its head, the animation
 * frames it ran, whether the tray was hidden as each screenshot was taken,
 * each close asked of an application with its options, and whether the
 * notification queue was cleared.
 */
function scriptedPage({ visibility = "visible", frames = true, pages = [], captures = [], refuse = [], fronting = "shows", evaluateFails = () => false, apps = [], toasts = 0 } = {}) {
  const page = {
    visibility,
    calls: [],
    sheets: new Map(),
    framesRun: 0,
    trayAtCapture: [],
    targets: [{ targetId: OWN, type: "page", url: "http://world.invalid/game" }, ...pages],
    apps: new Map(),
    closes: [],
    toasts: Array.from({ length: toasts }, (_, n) => `toast-${n}`),
    queueCleared: false,
  };
  for (const { id, name, throws } of apps) {
    page.apps.set(id, {
      id,
      constructor: { name },
      async close(options) {
        page.closes.push({ id, options });
        if (throws) throw new Error(`${name} refuses to close`);
        page.apps.delete(id);
      },
    });
  }
  const onVisibilityChange = [];
  const show = () => {
    page.visibility = "visible";
    for (const listener of onVisibilityChange.splice(0)) listener();
  };
  const context = vm.createContext({
    document: {
      get visibilityState() { return page.visibility; },
      head: { append: (el) => page.sheets.set(el.id, el) },
      createElement: () => ({ id: "", textContent: "", remove() { page.sheets.delete(this.id); } }),
      getElementById: (id) => page.sheets.get(id) ?? null,
      querySelector: (selector) => ({ closest: (ancestor) => (selector.startsWith(TRAY) && ancestor === TRAY ? {} : null) }),
      querySelectorAll: (selector) => (selector === `${TRAY} .notification` ? page.toasts : [])
        .map((toast) => ({ remove: () => page.toasts.splice(page.toasts.indexOf(toast), 1) })),
      addEventListener: (type, listener) => { if (type === "visibilitychange") onVisibilityChange.push(listener); },
    },
    foundry: { applications: { instances: page.apps } },
    ui: { notifications: { clear: () => { page.queueCleared = true; } } },
    requestAnimationFrame: (fn) => {
      if (frames && page.visibility === "visible") setImmediate(() => { page.framesRun++; fn(); });
    },
    // A page-side wait is cut to 40 ms, so no case sits out the driver's own.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 40)),
    clearTimeout,
  });
  const refused = (method) => {
    if (refuse.includes(method)) throw new Error(JSON.stringify({ code: -32000, message: `${method} refused` }));
  };
  page.channels = {
    targetId: OWN,
    browser: async (method, params) => {
      page.calls.push({ channel: "browser", method, params });
      refused(method);
      if (method === "Target.getTargets") return { targetInfos: page.targets.map((t) => ({ ...t })) };
      if (method === "Target.closeTarget") {
        const at = page.targets.findIndex((t) => t.targetId === params.targetId);
        if (at >= 0 && !page.targets[at].stays) page.targets.splice(at, 1);
        return { success: true };
      }
      throw new Error(`unscripted browser command ${method}`);
    },
    page: async (method, params, timeout) => {
      page.calls.push({ channel: "page", method, params, timeout });
      refused(method);
      if (method === "Page.bringToFront") {
        if (fronting === "shows") show();
        else if (fronting === "lags") setTimeout(show, 15);
        return {};
      }
      if (method === "Page.captureScreenshot") {
        page.trayAtCapture.push(page.sheets.size > 0);
        const outcome = captures.length ? captures.shift() : "ok";
        if (outcome !== "ok") throw new Error(outcome);
        return { data: PNG };
      }
      throw new Error(`unscripted page command ${method}`);
    },
    evaluate: async (expression, timeout) => {
      const call = { channel: "evaluate", expression, timeout };
      page.calls.push(call);
      if (evaluateFails(expression, page)) throw new Error("timeout: Runtime.evaluate");
      call.result = await vm.runInContext(expression, context);
      return call.result;
    },
  };
  return page;
}

/** A stand-in WebSocket: keeps what was sent, and delivers a reply on demand. */
function scriptedSocket() {
  const listeners = [];
  return {
    sent: [],
    addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); },
    send(text) { this.sent.push(JSON.parse(text)); },
    reply: (msg) => listeners.forEach((fn) => fn({ data: JSON.stringify(msg) })),
  };
}

/** Run `step` with console.warn collected: `{value, lines}`, or `{error, lines}` when it throws. */
async function collectWarnings(step) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    return { value: await step(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.warn = original;
  }
}

/** `promise`'s outcome as a string, or "still pending" once `ms` pass. */
function settledWithin(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve("still pending"), ms); });
  const outcome = promise.then((value) => `resolved ${JSON.stringify(value)}`, (err) => `rejected ${err.message}`);
  return Promise.race([outcome, late]).finally(() => clearTimeout(timer));
}

const runningTimers = () => process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
const methods = (page, channel) => page.calls.filter((c) => c.channel === channel).map((c) => c.method);
const screenshots = (page) => page.calls.filter((c) => c.method === "Page.captureScreenshot");
const same = (problems, what, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const matches = (problems, what, lines, expected) => {
  for (const re of expected) if (!lines.some((line) => re.test(line))) problems.push(`${what}: no line matches ${re}`);
  for (const line of lines) if (!expected.some((re) => re.test(line))) problems.push(`${what}: unexpected line: ${line}`);
};

const CASES = [
  {
    name: "a page at the browser's own address is stray; the driver's page, a document and a worker are not",
    async run(problems) {
      const settings = { targetId: "t-settings", type: "page", url: "CHROME://settings/" };
      const shouted = { targetId: "t-shouted", type: "page", url: "HTTPS://WORLD.INVALID/" };
      const unnamed = { targetId: "t-unnamed", type: "page", url: "" };
      const own = { targetId: OWN, type: "page", url: "chrome://version/" };
      const strays = strayPages([own, DIALOG, FIRST_RUN, BLANK, POPOUT, WORKER, settings, shouted, unnamed], OWN);
      same(problems, "strays", strays.map((t) => t.targetId), ["t-dialog", "t-first-run", "t-settings"]);
      same(problems, "no list", strayPages(undefined, OWN), []);
    },
  },
  {
    name: "an answered call resolves, a refused one rejects, and neither leaves a timer running",
    async run(problems) {
      const socket = scriptedSocket();
      const cdp = new Cdp(socket);
      const before = runningTimers();
      const answered = cdp.send("Runtime.evaluate", { expression: "1" }, "session-1");
      const refused = cdp.send("Target.closeTarget", { targetId: "gone" });
      same(problems, "frames sent", socket.sent, [
        { id: 1, method: "Runtime.evaluate", params: { expression: "1" }, sessionId: "session-1" },
        { id: 2, method: "Target.closeTarget", params: { targetId: "gone" } },
      ]);
      socket.reply({ id: 2, error: { code: -32602, message: "No target with given id found" } });
      socket.reply({ id: 1, result: { result: { value: 1 } } });
      same(problems, "answered", await settledWithin(1000, answered), 'resolved {"result":{"value":1}}');
      same(problems, "refused", await settledWithin(1000, refused), 'rejected {"code":-32602,"message":"No target with given id found"}');
      same(problems, "timers left running", runningTimers() - before, 0);
    },
  },
  {
    name: "a call nothing answers is given up at its own timeout, and a late reply is dropped",
    async run(problems) {
      const socket = scriptedSocket();
      const cdp = new Cdp(socket);
      const call = cdp.send("Page.captureScreenshot", {}, "session-1", 40);
      same(problems, "unanswered", await settledWithin(2000, call), `rejected ${UNANSWERED}`);
      same(problems, "calls still awaiting a reply", cdp.pending.size, 0);
      socket.reply({ id: 1, result: { data: PNG } });
    },
  },
  {
    name: "front closes the browser's own pages once, activates the driver's page, and says it was hidden",
    async run(problems) {
      const page = scriptedPage({ visibility: "hidden", pages: [{ ...DIALOG, stays: true }, FIRST_RUN, BLANK, POPOUT, WORKER] });
      const keeper = pageKeeper(page.channels);
      const first = await collectWarnings(() => keeper.front("compose()"));
      same(problems, "found", first.value, { visibility: "hidden", closed: [DIALOG.url, FIRST_RUN.url] });
      same(problems, "browser commands", methods(page, "browser"), ["Target.getTargets", "Target.closeTarget", "Target.closeTarget"]);
      same(problems, "page commands", methods(page, "page"), ["Page.bringToFront"]);
      same(problems, "pages left", page.targets.map((t) => t.targetId), [OWN, "t-dialog", "t-blank", "t-popout", "t-worker"]);
      matches(problems, "first call", first.lines, [
        /closed a page the browser opened for itself, before compose\(\): edge:\/\/sync-confirmation-dialog\/$/,
        /closed a page the browser opened for itself, before compose\(\): chrome-extension:\/\/\S+\/first-run\.html$/,
        /page was hidden before compose\(\) — brought to front$/,
      ]);
      page.calls.length = 0;
      const second = await collectWarnings(() => keeper.front("shot()"));
      same(problems, "found again", second.value, { visibility: "visible", closed: [] });
      same(problems, "browser commands again", methods(page, "browser"), ["Target.getTargets"]);
      same(problems, "page commands again", methods(page, "page"), ["Page.bringToFront"]);
      matches(problems, "second call", second.lines, []);
    },
  },
  {
    name: "a step the browser refuses is a warning, and the page is still fronted",
    async run(problems) {
      const page = scriptedPage({ pages: [FIRST_RUN], refuse: ["Target.getTargets"] });
      const { value, error, lines } = await collectWarnings(() => pageKeeper(page.channels).front("compose()"));
      same(problems, "threw", error?.message ?? null, null);
      same(problems, "found", value, { visibility: "visible", closed: [] });
      same(problems, "page commands", methods(page, "page"), ["Page.bringToFront"]);
      matches(problems, "warnings", lines, [/listing the browser's pages failed before compose\(\): .*Target\.getTargets refused/]);
    },
  },
  {
    name: "a page that fronting does not show is reported as still hidden; one that shows a moment late is not",
    async run(problems) {
      const stuck = scriptedPage({ visibility: "hidden", fronting: "stuck" });
      const held = await collectWarnings(() => pageKeeper(stuck.channels).front("compose()"));
      same(problems, "found stuck", held.value, { visibility: "hidden", closed: [] });
      matches(problems, "stuck", held.lines, [/page was hidden before compose\(\) and is hidden after fronting/]);
      const late = scriptedPage({ visibility: "hidden", fronting: "lags" });
      const shown = await collectWarnings(() => pageKeeper(late.channels).front("compose()"));
      matches(problems, "late", shown.lines, [/page was hidden before compose\(\) — brought to front$/]);
    },
  },
  {
    name: "compose fronts the page, then closes every window but the subject, unanimated, and clears the toasts",
    async run(problems) {
      const page = scriptedPage({
        visibility: "hidden",
        toasts: 2,
        apps: [
          { id: "sidebar", name: "Sidebar" },
          { id: "sheet-1", name: "ActorSheet" },
          { id: "stubborn", name: "Onboarding", throws: true },
          { id: "dialog-1", name: "DialogV2" },
        ],
      });
      const { value, error, lines } = await collectWarnings(() => pageKeeper(page.channels).compose("#sheet-1"));
      same(problems, "threw", error?.message ?? null, null);
      same(problems, "closed", value, ["Sidebar", "Onboarding", "DialogV2"]);
      const unanimated = { animate: false };
      same(problems, "closes asked for", page.closes,
        [{ id: "sidebar", options: unanimated }, { id: "stubborn", options: unanimated }, { id: "dialog-1", options: unanimated }]);
      same(problems, "windows left", [...page.apps.keys()], ["sheet-1", "stubborn"]);
      same(problems, "toasts left", { inTray: page.toasts.length, queueCleared: page.queueCleared }, { inTray: 0, queueCleared: true });
      const fronted = page.calls.findIndex((c) => c.method === "Page.bringToFront");
      const swept = page.calls.findIndex((c) => c.channel === "evaluate" && c.expression.includes("applications.instances"));
      if (!(fronted >= 0 && fronted < swept)) problems.push("the page was not fronted before its windows were closed");
      matches(problems, "warnings", lines, [/page was hidden before compose\(\) — brought to front$/]);
      const bare = scriptedPage({ apps: [{ id: "a", name: "Players" }, { id: "b", name: "Hotbar" }] });
      same(problems, "closed with no subject", await pageKeeper(bare.channels).compose(), ["Players", "Hotbar"]);
    },
  },
  {
    name: "a capture fronts the page, waits for frames, and hides the tray only while the frame is taken",
    async run(problems) {
      const page = scriptedPage();
      const clip = { x: 80, y: 40, width: 760, height: 827, scale: 1 };
      const { value, lines } = await collectWarnings(() => pageKeeper(page.channels).capture({ clip, subject: "#sheet" }));
      same(problems, "data", value, PNG);
      same(problems, "tray hidden at the capture", page.trayAtCapture, [true]);
      same(problems, "sheets left in the head", page.sheets.size, 0);
      same(problems, "page commands", methods(page, "page"), ["Page.bringToFront", "Page.captureScreenshot"]);
      const [shot] = screenshots(page);
      same(problems, "screenshot params", shot?.params, { format: "png", clip, captureBeyondViewport: false });
      if (!(shot?.timeout > 0 && shot.timeout <= 30_000)) problems.push(`screenshot timeout: got ${shot?.timeout}, expected at most 30000 ms`);
      const probe = page.calls.find((c) => c.channel === "evaluate" && c.expression.includes("requestAnimationFrame"));
      if (!probe || page.calls.indexOf(probe) > page.calls.indexOf(shot)) problems.push("no frame probe ran before the screenshot");
      else {
        same(problems, "frame probe's answer", probe.result, true);
        same(problems, "frames the probe waited for", page.framesRun, 2);
        if (!(probe.timeout > 0)) problems.push("the frame probe carries no timeout of its own");
      }
      const restore = page.calls.filter((c) => c.channel === "evaluate").at(-1);
      if (page.calls.indexOf(restore) < page.calls.indexOf(shot)) problems.push("the tray was not restored after the screenshot");
      else if (!(restore.timeout > 0 && restore.timeout <= 30_000)) problems.push(`tray restore timeout: got ${restore.timeout}, expected at most 30000 ms`);
      matches(problems, "warnings", lines, []);
    },
  },
  {
    name: "a subject inside the tray is shot with the tray showing; an unclipped frame is not",
    async run(problems) {
      const toast = scriptedPage();
      await pageKeeper(toast.channels).capture({ subject: `${TRAY} .notification` });
      same(problems, "tray hidden for a toast", toast.trayAtCapture, [false]);
      const viewport = scriptedPage();
      await pageKeeper(viewport.channels).capture();
      same(problems, "tray hidden for the viewport", viewport.trayAtCapture, [true]);
      same(problems, "viewport screenshot params", screenshots(viewport)[0]?.params, { format: "png", captureBeyondViewport: false });
    },
  },
  {
    name: "a capture nothing answers is tried once more, after fronting the page again",
    async run(problems) {
      const page = scriptedPage({ captures: [UNANSWERED] });
      const { value, lines } = await collectWarnings(() => pageKeeper(page.channels).capture({ subject: "#sheet" }));
      same(problems, "data", value, PNG);
      same(problems, "page commands", methods(page, "page"),
        ["Page.bringToFront", "Page.captureScreenshot", "Page.bringToFront", "Page.captureScreenshot"]);
      same(problems, "tray hidden at each capture", page.trayAtCapture, [true, true]);
      same(problems, "sheets left in the head", page.sheets.size, 0);
      matches(problems, "warnings", lines, [/capture failed \(timeout: Page\.captureScreenshot, animation frames arriving\) — trying once more$/]);
    },
  },
  {
    name: "two failed captures throw, naming both, and the tray is restored",
    async run(problems) {
      const unable = JSON.stringify({ code: -32000, message: "Unable to capture screenshot" });
      const page = scriptedPage({ frames: false, captures: [UNANSWERED, unable, "ok"] });
      const { value, error } = await collectWarnings(() => pageKeeper(page.channels).capture({ subject: "#sheet" }));
      same(problems, "data", value ?? null, null);
      same(problems, "error", error?.message ?? null,
        `foundry-capture: no screenshot in two attempts — ${UNANSWERED}, animation frames not arriving; then ${unable}, animation frames not arriving`);
      same(problems, "screenshots asked for", screenshots(page).length, 2);
      same(problems, "sheets left in the head", page.sheets.size, 0);
    },
  },
  {
    name: "the frame is asked for whatever the frame probe says, or fails to say",
    async run(problems) {
      const still = scriptedPage({ frames: false });
      same(problems, "no frames", await pageKeeper(still.channels).capture(), PNG);
      const mute = scriptedPage({ evaluateFails: (expression) => expression.includes("requestAnimationFrame") });
      same(problems, "no answer", await pageKeeper(mute.channels).capture(), PNG);
    },
  },
  {
    name: "a tray that cannot be restored is a warning, and the frame is still returned",
    async run(problems) {
      const page = scriptedPage({ evaluateFails: (expression, p) => expression.includes("getElementById") && p.trayAtCapture.length > 0 });
      const { value, lines } = await collectWarnings(() => pageKeeper(page.channels).capture({ subject: "#sheet" }));
      same(problems, "data", value, PNG);
      matches(problems, "warnings", lines, [/could not restore the notification tray: timeout: Runtime\.evaluate$/]);
    },
  },
];

let failures = 0;
for (const testCase of CASES) {
  const problems = [];
  try {
    await testCase.run(problems);
  } catch (err) {
    problems.push(`threw: ${err.stack ?? err}`);
  }
  if (problems.length) {
    failures++;
    console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}`);
  } else console.log(`ok   ${testCase.name}`);
}
const shown = path.relative(TEMPLATE_ROOT, DRIVER);
console.log(`test-foundry-capture: ${CASES.length} cases against ${shown.startsWith("..") ? DRIVER : shown}, ${failures} failed`);
if (failures) process.exit(1);
