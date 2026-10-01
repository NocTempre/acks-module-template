/**
 * Headless capture driver for release snapshots (TOOLCHAIN §4b).
 *
 * WHY THIS EXISTS. Snapshots have to be taken from the live world during the
 * §4a verification session, and the obvious route — screenshot the browser
 * pane an agent is already driving — does not work: the pane only composites
 * frames while it is on screen, so a headless or backgrounded session times
 * out with no picture. This drives a throwaway Chromium over the DevTools
 * protocol instead, which composites off screen while its page holds the
 * foreground (below), and can clip the capture to one element's bounding box.
 *
 * Clipping is not a convenience. §4b requires the world id, user name and
 * server URL stay out of frame, and Foundry paints all three into the players
 * panel, settings tab and window title. Clipping to the app window excludes
 * them by construction rather than by remembering to crop.
 *
 * The browser it launches is a separate throwaway profile: it cannot disturb a
 * browser the developer is using, and closing UI windows to compose a frame
 * (below) affects only this session's DOM. Nothing the driver does on its own
 * writes to the world; what a run creates through it is recorded in the
 * fixture ledger (below) and removed by it.
 *
 * NOTHING MACHINE-SPECIFIC LIVES HERE. Browser binary, origin and user name
 * are arguments; their values are local-only and belong in the machine's
 * TEST_ENVIRONMENT.md, never in a repo.
 *
 * Requires Node >= 22 (global WebSocket) and a Chromium-family browser.
 *
 * USAGE — one small script per shot. Note the `file:///` scheme: Node's ESM
 * loader rejects a bare Windows absolute path ("protocol 'c:'"), so importing
 * this by drive-letter path fails before anything runs.
 *
 *   import { connect, sleep } from "file:///C:/Proj/acks-module-template/bin/foundry-capture.mjs";
 *
 *   const api = await connect({ browser: EDGE, origin: ORIGIN, user: "Gamemaster" });
 *   try {
 *     await api.compose();                       // clear popups from other modules
 *     const inn = await api.create("Actor", { name: "Snapshot Fixture — Inn", type: "acks-extras.location" });
 *     const sel = await api.eval(`(async () => {
 *       const a = await fromUuid(${JSON.stringify(inn.uuid)});
 *       await a.sheet.render(true);
 *       return "#" + a.sheet.id;
 *     })()`);
 *     await sleep(2000);
 *     await api.compose(sel);                    // sweep anything the write popped up
 *     console.log(await api.shot("docs/releases/v0.3.0/location-sheet.png", sel));
 *   } finally {
 *     console.log(await api.sweepTracked());     // { removed, missing, failed } — quote it in the report
 *     api.close();
 *   }
 *
 * THE FIXTURE LEDGER. Every document a run creates is recorded by uuid the
 * moment it exists — `create()` records what it makes; `track()` records one
 * made any other way, including one the feature wrote itself once its id has
 * been read back — and `sweepTracked()` deletes exactly that list, newest
 * first, re-resolving each uuid to prove it is gone. It returns what it
 * removed, what it could not find and what refused to go, and the report
 * quotes that object. Teardown keys on the run's own uuids and on nothing
 * else: the world is shared, so a delete keyed on a name, a name prefix, a
 * folder, a type or a time window takes other sessions' documents with
 * yours. Every `track` prints its uuid, so a run that dies before its sweep
 * leaves its ids in its log; the next run re-tracks those ids and sweeps —
 * it never goes looking by name. `close()` warns while the ledger holds
 * entries. A session driving a browser pane instead keeps the same list and
 * runs `pageSweep(entries)` there — the very expression the driver uses.
 *
 * A FRAME IS TAKEN OF A FOREGROUND PAGE WITH NO TOAST ON IT. A page that loses
 * the foreground is hidden: it paints no frames, its transitions never end and
 * its timers are throttled, so a capture, or a window close awaiting its
 * transition, stops answering there. `compose()` and `shot()` put the page
 * back in front before they do anything (`pageKeeper`) and say so when they
 * found it hidden; a walk's own `api.eval` is not fronted, so close a window
 * there with `{ animate: false }`, as `compose()` does. `shot()` also hides
 * the notification tray for the capture itself, since a toast can land after
 * any `compose()` — to photograph a toast, clip to it.
 *
 * SHOOTING A CHAT CARD takes two extra moves, and skipping either one fails in
 * a way that reads as "the message was never posted":
 *
 *   - **Re-render the Hotbar before any ChatLog render.** `compose()` closes
 *     every application, and `ChatLog#_onRender` reaches into the hotbar
 *     (`_toggleNotifications` → `#offsetHotbar`), so the render throws on a
 *     null element and no log appears. `await ui.hotbar.render(true)` first.
 *   - **Use the POPOUT log, not the docked sidebar.** The sidebar is anchored
 *     to the right edge and sits past the headless viewport, so clipping to a
 *     message in it captures a ~14px sliver. `renderPopout()` gives an ordinary
 *     floating window; `setPosition` it somewhere on screen and clip to the
 *     card's own root — which also keeps the message header, and with it the
 *     seat's user name, out of frame.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How long a DevTools call may go unanswered, in ms: any call, a screenshot,
// and a page-side read or restore that needs no frame to answer.
const CDP_TIMEOUT_MS = 90_000;
const CAPTURE_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
// How long `pageFrames` waits, page-side, for two animation frames.
const FRAME_WAIT_MS = 4_000;
// The stylesheet `pageTray` adds; a restore removes that sheet and no other.
const TRAY_STYLE_ID = "foundry-capture-quiet-tray";

/**
 * Page-side expression that deletes exactly `entries` (`[{uuid, kind}]`, in
 * the order given) and returns `{removed, missing, failed}` as JSON, each
 * entry carrying its uuid, kind and name. A uuid whose container does not
 * resolve at all (unknown document type, absent pack) lands in `failed` with
 * the reason, so `missing` means precisely "resolved, and found nothing".
 * Every removal is re-resolved after the delete; a document still present is
 * `failed`, never `removed`. Exported so a session driving a browser pane can
 * sweep its own ledger with the same code the driver runs.
 */
export function pageSweep(entries) {
  return `(async () => {
    const out = { removed: [], missing: [], failed: [] };
    for (const entry of ${JSON.stringify(entries)}) {
      if (!foundry.utils.parseUuid(entry.uuid)?.collection) {
        out.failed.push({ ...entry, error: "unresolvable uuid: unknown document type or absent pack" });
        continue;
      }
      const doc = await fromUuid(entry.uuid);
      if (!doc) { out.missing.push(entry); continue; }
      const found = { ...entry, name: doc.name ?? null };
      try { await doc.delete(); }
      catch (err) { out.failed.push({ ...found, error: String(err?.message ?? err) }); continue; }
      if (await fromUuid(entry.uuid)) out.failed.push({ ...found, error: "still present after delete()" });
      else out.removed.push(found);
    }
    return JSON.stringify(out);
  })()`;
}

/**
 * The payload `create()` sends: an Actor that states `system` and no `items`
 * goes with `items: []`. The acks system's `AcksActor.create` treats a payload
 * without items as a blank new actor — it replaces `system` with `{isNew:
 * true}` and seeds a character's coins — so every figure a fixture set would
 * be dropped without a word. A payload that states no `system` keeps that path.
 */
function createPayload(kind, data) {
  return kind === "Actor" && data?.system != null && data.items == null ? { ...data, items: [] } : data;
}

/**
 * Page-side expression creating one document of `kind` from `data` — embedded
 * in the document at `parentUuid` when given — and returning JSON: `{doc:
 * {uuid, id, name}}`, `{doc: null}` when Foundry's create resolved to nothing,
 * or `{error}` when the type or the parent does not resolve.
 */
function pageCreate(kind, data, parentUuid = null) {
  return `(async () => {
    const kind = ${JSON.stringify(kind)}, parentUuid = ${JSON.stringify(parentUuid)};
    const cls = foundry.utils.getDocumentClass(kind);
    if (!cls) return JSON.stringify({ error: "unknown document type: " + kind });
    const parent = parentUuid ? await fromUuid(parentUuid) : null;
    if (parentUuid && !parent) return JSON.stringify({ error: "parent not found: " + parentUuid });
    const doc = await cls.create(${JSON.stringify(data)}, parent ? { parent } : {});
    return JSON.stringify({ doc: doc ? { uuid: doc.uuid, id: doc.id, name: doc.name ?? null } : null });
  })()`;
}

/**
 * The fixture ledger behind `api.create` / `api.track` / `api.tracked` /
 * `api.sweepTracked`: uuid → `{uuid, kind}` in creation order, bound to an
 * `evaluate(expression)` that runs page-side code and returns its value.
 * `connect()` composes it into the capture handle; it is exported so the same
 * ledger can be driven against any page evaluator, a test's included.
 */
export function fixtureLedger(evaluate) {
  const ledger = new Map();
  const isTypeName = (kind) => /^[A-Z][A-Za-z]+$/.test(kind ?? "");
  // A bare id needs its document type to become a uuid; a uuid carries its
  // type two segments from the end (`Actor.a`, `Actor.a.Item.b`,
  // `Compendium.scope.pack.Actor.a`), and a `kind` given beside one must agree.
  const normalize = (ref, kind) => {
    if (typeof ref !== "string" || !ref) throw new Error("foundry-capture: track() needs a uuid or id string");
    if (kind !== undefined && !isTypeName(kind)) throw new Error(`foundry-capture: "${kind}" is not a document type name (Actor, Item, Scene, JournalEntry, …)`);
    if (ref.startsWith(".")) throw new Error(`foundry-capture: "${ref}" is a relative uuid — track the absolute one`);
    if (!ref.includes(".")) {
      if (!kind) throw new Error(`foundry-capture: track("${ref}") — a bare id needs its document type as the second argument`);
      return { uuid: `${kind}.${ref}`, kind };
    }
    const parts = ref.split(".");
    const type = parts[parts.length - 2];
    if (!isTypeName(type)) throw new Error(`foundry-capture: "${ref}" is not a document uuid`);
    if (kind && kind !== type) throw new Error(`foundry-capture: uuid "${ref}" is a ${type}, not a ${kind}`);
    return { uuid: ref, kind: type };
  };

  const api = {
    /**
     * Record a document this run created — by uuid, or by id plus its document
     * type — so `sweepTracked()` deletes it. Idempotent per uuid; returns the
     * uuid; prints it, so the run's log holds every id even if the run dies
     * before its sweep.
     */
    track(uuidOrId, kind) {
      const entry = normalize(uuidOrId, kind);
      if (!ledger.has(entry.uuid)) {
        ledger.set(entry.uuid, entry);
        console.log(`  track: ${entry.uuid}`);
      }
      return entry.uuid;
    },

    /** The ledger as it stands: `[{uuid, kind}]` in creation order. */
    tracked() {
      return [...ledger.values()];
    },

    /**
     * Create one document in page context and track it. `data` is the plain
     * create payload (JSON; `type` selects a sub-type); `parent` is the uuid of
     * the document an embedded one is created inside. Resolves to `{uuid, id,
     * name}`. An Actor that states `system` and no `items` is sent with
     * `items: []` (`createPayload`). A create that resolves to nothing throws,
     * naming the likeliest cause — a sub-type the server has not loaded, which
     * needs a world relaunch — rather than handing back a fixture that does not
     * exist.
     */
    async create(kind, data, { parent = null } = {}) {
      if (!isTypeName(kind)) throw new Error(`foundry-capture: create() needs a document type name, got "${kind}"`);
      const result = JSON.parse(await evaluate(pageCreate(kind, createPayload(kind, data), parent)));
      if (result.error) throw new Error(`foundry-capture: create(${kind}) — ${result.error}`);
      if (!result.doc) throw new Error(`foundry-capture: ${kind}.create resolved to nothing — a sub-type the server has not loaded (relaunch the world), or a type this seat may not create`);
      api.track(result.doc.uuid, kind);
      return result.doc;
    },

    /**
     * Delete every tracked document, newest first, proving each is gone.
     * Resolves to `{removed, missing, failed}`: `missing` resolved to nothing
     * (already deleted, or never the id you thought); `failed` refused or is
     * still present, and stays in the ledger so a retry re-runs exactly it.
     * Deletes nothing the ledger does not name.
     */
    async sweepTracked() {
      const entries = [...ledger.values()].reverse();
      if (!entries.length) return { removed: [], missing: [], failed: [] };
      const out = JSON.parse(await evaluate(pageSweep(entries)));
      for (const e of [...out.removed, ...out.missing]) ledger.delete(e.uuid);
      for (const e of out.failed) console.warn(`  warn: could not remove ${e.uuid}${e.name ? ` (${e.name})` : ""}: ${e.error}`);
      return out;
    },
  };
  return api;
}

/**
 * The page targets a browser opened for itself: every page but the driver's
 * own (`ownTargetId`) whose address is not a document's — any scheme other
 * than http(s), about, file, data and blob, so `edge://…`, `chrome://…` and an
 * extension's `chrome-extension://…` page. Takes the `targetInfos` of
 * `Target.getTargets` and returns the entries among them.
 */
export function strayPages(targetInfos, ownTargetId) {
  return (targetInfos ?? []).filter(
    (t) => t.type === "page" && t.targetId !== ownTargetId && Boolean(t.url) && !/^(https?|about|file|data|blob):/i.test(t.url),
  );
}

/**
 * Page-side expression resolving to `document.visibilityState`. With `waitMs`,
 * a page not yet visible is given that long to become so: the state follows
 * `Page.bringToFront` by a moment.
 */
function pageVisibility(waitMs = 0) {
  if (!waitMs) return "document.visibilityState";
  return `document.visibilityState === "visible" ? "visible" : new Promise((resolve) => {
    const done = () => resolve(document.visibilityState);
    document.addEventListener("visibilitychange", done, { once: true });
    setTimeout(done, ${waitMs});
  })`;
}

/**
 * Page-side expression resolving `true` once two animation frames have run —
 * the second follows a paint of everything written before the first — or
 * `false` when `ms` passes without them, as it does on a hidden page.
 */
function pageFrames(ms) {
  return `new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ${ms});
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(true); }));
  })`;
}

/**
 * Page-side expression that hides the notification tray (`hide` true) or
 * restores it, by adding or removing one stylesheet, and returns whether the
 * tray is now hidden. `visibility` keeps the tray's box, so nothing in the
 * frame moves. A `subject` selector that resolves inside the tray leaves it
 * showing: the toast is then what is being shot.
 */
function pageTray(hide, subject = null) {
  return `(() => {
    const id = ${JSON.stringify(TRAY_STYLE_ID)}, subject = ${JSON.stringify(subject)};
    document.getElementById(id)?.remove();
    if (!${Boolean(hide)} || (subject && document.querySelector(subject)?.closest("#notifications"))) return false;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "#notifications, #notifications * { visibility: hidden !important; }";
    document.head.append(style);
    return true;
  })()`;
}

/**
 * Page-side expression that closes every open application but the one whose
 * id is `keepId`, removes the notification toasts, and returns the class names
 * of the applications it asked to close, as JSON. Each close is unanimated: an
 * animated one waits out a transition, or a second where its element has none,
 * and longer than that on a hidden page. A close that throws is passed over.
 */
function pageCompose(keepId) {
  return `(async () => {
    const keep = ${JSON.stringify(keepId)}, closed = [];
    for (const app of foundry.applications.instances.values()) {
      if (keep && app.id === keep) continue;
      try { closed.push(app.constructor.name); await app.close({ animate: false }); } catch {}
    }
    ui.notifications?.clear?.();
    document.querySelectorAll("#notifications .notification").forEach(n => n.remove());
    return JSON.stringify(closed);
  })()`;
}

/**
 * The page keeper behind `api.compose` / `api.shot`: `front()` puts the
 * driver's page back in the foreground, `compose()` clears it of windows and
 * toasts, and `capture()` takes one frame of it with the notification tray
 * out of the picture. Bound to `targetId`, the driver's own page, and to the
 * three channels that page is driven through: `browser(method, params)` for
 * the browser's commands, `page(method, params, timeout)` for the page
 * session's, and `evaluate(expression, timeout)` for page-side code, each
 * `timeout` in ms. `connect()` composes it into the capture handle; it is
 * exported so the same sequence can be driven against a scripted page, a
 * test's included.
 */
export function pageKeeper({ targetId, browser, page, evaluate }) {
  // Strays already asked to close: one the browser keeps listed is asked once.
  const dismissed = new Set();
  // One step of `front()`: its value, or undefined after a warning.
  const attempt = async (what, why, step) => {
    try { return await step(); }
    catch (err) { console.warn(`  warn: ${what} failed before ${why}: ${err.message}`); return undefined; }
  };

  const keeper = {
    /**
     * Close the pages the browser opened for itself (`strayPages`), activate
     * the driver's page, and resolve to `{visibility, closed}`: the page's
     * `document.visibilityState` as found (null when it did not answer) and
     * the urls closed by this call. Warns when the page was found hidden, and
     * says whether activating it showed it. `why` names the caller's step in
     * those lines. A step that fails is a warning and the next one still runs.
     */
    async front(why) {
      const visibility = (await attempt("reading the page's visibility", why, () => evaluate(pageVisibility(), PROBE_TIMEOUT_MS))) ?? null;
      const closed = [];
      const listed = await attempt("listing the browser's pages", why, () => browser("Target.getTargets"));
      for (const stray of strayPages(listed?.targetInfos, targetId)) {
        if (dismissed.has(stray.targetId)) continue;
        dismissed.add(stray.targetId);
        const done = await attempt(`closing ${stray.url}`, why, () => browser("Target.closeTarget", { targetId: stray.targetId }));
        if (done === undefined) continue;
        closed.push(stray.url);
        console.warn(`  warn: closed a page the browser opened for itself, before ${why}: ${stray.url}`);
      }
      await attempt("fronting the page", why, () => page("Page.bringToFront"));
      if (visibility !== null && visibility !== "visible") {
        const after = (await attempt("re-reading the page's visibility", why, () => evaluate(pageVisibility(1000), PROBE_TIMEOUT_MS))) ?? "not answering";
        console.warn(after === "visible"
          ? `  warn: page was ${visibility} before ${why} — brought to front`
          : `  warn: page was ${visibility} before ${why} and is ${after} after fronting — a wait on a frame or a timer will stall`);
      }
      return { visibility, closed };
    },

    /**
     * Front the page, then close every open application except the one
     * `keepSelector` names (an `#id`) and clear the toasts (`pageCompose`).
     * Resolves to the class names of the applications it asked to close.
     */
    async compose(keepSelector = null) {
      await keeper.front("compose()");
      return JSON.parse(await evaluate(pageCompose(keepSelector ? keepSelector.replace(/^#/, "") : "")));
    },

    /**
     * Take one PNG frame of the page — clipped to `clip` when given — and
     * resolve to its base64 data. The notification tray is hidden for the
     * capture and restored after it, pass or fail, unless `subject` (the
     * selector being shot) lies inside the tray. Each attempt fronts the page
     * and waits for two animation frames first. A capture unanswered after
     * CAPTURE_TIMEOUT_MS is given up and tried once more; a second failure
     * throws, naming both and whether frames were arriving.
     */
    async capture({ clip = null, subject = null } = {}) {
      try {
        await evaluate(pageTray(true, subject));
        let first = null;
        for (;;) {
          await keeper.front(first ? "shot()'s retry" : "shot()");
          const frames = await evaluate(pageFrames(FRAME_WAIT_MS), FRAME_WAIT_MS + PROBE_TIMEOUT_MS).catch(() => null);
          try {
            const shot = await page("Page.captureScreenshot",
              { format: "png", ...(clip ? { clip } : {}), captureBeyondViewport: false }, CAPTURE_TIMEOUT_MS);
            return shot.data;
          } catch (err) {
            const failure = `${err.message}, animation frames ${frames === null ? "not probed" : frames ? "arriving" : "not arriving"}`;
            if (first) throw new Error(`foundry-capture: no screenshot in two attempts — ${first}; then ${failure}`);
            first = failure;
            console.warn(`  warn: capture failed (${failure}) — trying once more`);
          }
        }
      } finally {
        await evaluate(pageTray(false), PROBE_TIMEOUT_MS).catch((err) => console.warn(`  warn: could not restore the notification tray: ${err.message}`));
      }
    },
  };
  return keeper;
}

/**
 * One DevTools connection over an open WebSocket. `send` resolves to a
 * command's result, rejects with the browser's error object as JSON, and
 * rejects `timeout: <method>` when no reply comes within `timeout` ms; a reply
 * that arrives after that is dropped. Events are not dispatched.
 */
export class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId, timeout = CDP_TIMEOUT_MS) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
}

const openWs = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.addEventListener("open", () => resolve(ws));
  ws.addEventListener("error", reject);
});

/**
 * Launch a throwaway browser, join the world, and return a capture handle.
 * Resolves only once `game.ready` is true, so callers never race the load.
 */
export async function connect({ browser, origin, user, port = 9333, width = 1600, height = 1000, readySeconds = 90 }) {
  for (const [k, v] of Object.entries({ browser, origin, user })) {
    if (!v) throw new Error(`foundry-capture: missing required option "${k}"`);
  }
  if (!fs.existsSync(browser)) throw new Error(`foundry-capture: browser not found at ${browser}`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "acks-capture-"));
  // `--disable-sync`: a fresh profile can sign in with the OS account, and what
  // that account syncs — an extension, with its first-run tab — opens over the page.
  const proc = spawn(browser, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate,AcceptCHFrame", "--disable-sync", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", () => {});
  /**
   * Tear the session down completely. Two things beyond `proc.kill()`, and both
   * are load-bearing:
   *
   *  - **Kill by PROFILE, not by pid.** A browser is a launcher plus renderer,
   *    GPU, network and crashpad children, and `proc.kill()` signals only the
   *    launcher — which on Windows has usually already exited and left its
   *    children re-parented, so killing the pid (or even its tree) reaps
   *    nothing. The throwaway `--user-data-dir` is unique to this session and
   *    every child carries it on its command line, so it is the one handle that
   *    finds all of them. Without this a session that shoots a dozen frames
   *    leaves dozens of orphans, and once enough pile up the next `connect()`
   *    starves and the capture "just stops working".
   *  - **Close the CDP socket.** An open WebSocket holds node's event loop, so
   *    a script that finished its work never exits and looks hung.
   *
   * Callers do not have to know any of this: `close()` leaves nothing running.
   */
  let cdpSocket = null;
  const cleanup = () => {
    try { cdpSocket?.close(); } catch {}
    try { proc.kill(); } catch {}
    if (process.platform === "win32") {
      // -Filter cannot match on CommandLine, so the profile test is a Where-Object.
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='${path.basename(browser).replace(/'/g, "''")}'" | ` +
        `Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, "\\").replace(/'/g, "''")}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      try { execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" }); } catch {}
    }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  try {
    let wsUrl = null;
    for (let i = 0; i < 40 && !wsUrl; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl;
      } catch { /* not up yet */ }
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) throw new Error("devtools endpoint never came up");

    const ws = await openWs(wsUrl);
    cdpSocket = ws;
    const cdp = new Cdp(ws);
    const { targetId } = await cdp.send("Target.createTarget", { url: `${origin}/join` });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await sleep(2500);

    // Page-side evaluation: awaits promises, throws on page errors, and gives
    // up after `timeout` ms where one is passed.
    const evaluate = async (expression, timeout) => {
      const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId, timeout);
      if (r.exceptionDetails) {
        throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
      }
      return r.result.value;
    };
    const keeper = pageKeeper({
      targetId,
      browser: (method, params) => cdp.send(method, params),
      page: (method, params, timeout) => cdp.send(method, params, sessionId, timeout),
      evaluate,
    });
    // The ledger's evaluator resolves `api` lazily; the handle is defined just below.
    const fixtures = fixtureLedger((expression) => api.eval(expression));
    const api = {
      /** Evaluate an expression in page context; awaits promises, throws on page errors. */
      async eval(expression) {
        return evaluate(expression);
      },

      /**
       * Compose the frame: close every open application except `keepSelector`,
       * and clear notification toasts. Other modules' onboarding dialogs open
       * over the subject and document writes raise toasts that bleed into the
       * clip — both were hit on the first real capture. The sweep is
       * `pageKeeper`'s `compose()`: the page is fronted first, so what the
       * walk renders next is painted, and each close is unanimated. Returns
       * what it closed so a report can say so. Affects only this throwaway
       * session's DOM.
       */
      async compose(keepSelector = null) {
        return keeper.compose(keepSelector);
      },

      /**
       * Capture to `file`. With a selector, clips to that element's box — which
       * is how §4b's "keep the machine out of frame" is actually enforced.
       * The frame is `pageKeeper`'s `capture()`: taken of a fronted page with
       * the notification tray hidden, and tried once more if it does not
       * answer. Creates the parent directory. Warns past the §4b ~300 KB
       * ceiling.
       */
      async shot(file, selector = null) {
        let clip;
        if (selector) {
          const rect = await api.eval(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)),
                     width: Math.ceil(r.width), height: Math.ceil(r.height) };
          })()`);
          if (!rect) throw new Error(`foundry-capture: selector not found: ${selector}`);
          if (rect.width < 2 || rect.height < 2) throw new Error(`foundry-capture: selector has no area: ${selector}`);
          clip = { ...rect, scale: 1 };
        }
        const data = await keeper.capture({ clip, subject: selector });
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, Buffer.from(data, "base64"));
        const bytes = fs.statSync(file).size;
        if (bytes > 300_000) console.warn(`  warn: ${file} is ${Math.round(bytes / 1024)} KB, over the ~300 KB §4b ceiling`);
        if (!clip) console.warn(`  warn: ${file} is a full-viewport shot — §4b wants a clipped window, and an unclipped frame can show the user name`);
        return { file, bytes, clip };
      },

      ...fixtures,

      /** Tear the session down (see `cleanup`). Warns while the ledger still holds entries. */
      close() {
        const left = fixtures.tracked();
        if (left.length) console.warn(`  warn: ${left.length} tracked fixture(s) not swept — sweepTracked() before close(): ${left.map((e) => e.uuid).join(", ")}`);
        cleanup();
      },
    };

    // The seat's id comes from the join page's own `game.users`, not from the
    // form. Foundry served a `<select name="userid">` of every user until v14
    // build 367, which replaced it with a free-text username box — scraping the
    // form now finds nothing, and that reads as "no world running". The page's
    // user data is there either way, so it is the stable place to look.
    //
    // Polled rather than read once: the join page is rendered by its own
    // scripts, and a fixed wait before the scrape races that render.
    const uid = await api.eval(`new Promise(res => { let n = 0; const t = setInterval(() => {
      const list = globalThis.game?.users ? [...game.users] : [];
      const u = list.find(u => u.name === ${JSON.stringify(user)});
      if (u?.id) { clearInterval(t); res(u.id); }
      else if (++n > 30) { clearInterval(t); res(null); }
    }, 500); })`);
    if (!uid)
      throw new Error(
        `foundry-capture: user "${user}" not on the join page after 15s — is a world running, and is that the user's exact name?`,
      );

    // `userId`, camelCase: the server reads `req.body.userId`. It was `userid`
    // before v14 build 367, and the old key authenticates as nobody — a 401
    // whose body is "JOIN.ErrorUserDoesNotExist", which reads as a wrong NAME
    // rather than a wrong key.
    await api.eval(`fetch("/join", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", userId: ${JSON.stringify(uid)}, password: "" }) }).then(r => r.text())`);
    await cdp.send("Page.navigate", { url: `${origin}/game` }, sessionId);
    await sleep(3000);

    const ready = await api.eval(`new Promise(res => { let n = 0; const t = setInterval(() => { n++;
      if (typeof game !== "undefined" && game.ready) { clearInterval(t); res("ready"); }
      else if (n > ${readySeconds}) { clearInterval(t); res("NOT READY at " + location.href); } }, 1000); })`);
    if (ready !== "ready") throw new Error(`foundry-capture: ${ready}`);

    return api;
  } catch (err) {
    cleanup();
    throw err;
  }
}
