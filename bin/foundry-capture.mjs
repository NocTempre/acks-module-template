/**
 * Headless capture driver for release snapshots (TOOLCHAIN §4b).
 *
 * WHY THIS EXISTS. Snapshots have to be taken from the live world during the
 * §4a verification session, and the obvious route — screenshot the browser
 * pane an agent is already driving — does not work: the pane only composites
 * frames while it is on screen, so a headless or backgrounded session times
 * out with no picture. This drives a throwaway Chromium over the DevTools
 * protocol instead, which composites regardless, and can clip the capture to
 * one element's bounding box.
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
     * name}`. A create that resolves to nothing throws, naming the likeliest
     * cause — a sub-type the server has not loaded, which needs a world
     * relaunch — rather than handing back a fixture that does not exist.
     */
    async create(kind, data, { parent = null } = {}) {
      if (!isTypeName(kind)) throw new Error(`foundry-capture: create() needs a document type name, got "${kind}"`);
      const result = JSON.parse(await evaluate(pageCreate(kind, data, parent)));
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

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`)); }, 90000);
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
  const proc = spawn(browser, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate,AcceptCHFrame", "about:blank",
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

    // The ledger's evaluator resolves `api` lazily; the handle is defined just below.
    const fixtures = fixtureLedger((expression) => api.eval(expression));
    const api = {
      /** Evaluate an expression in page context; awaits promises, throws on page errors. */
      async eval(expression) {
        const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) {
          throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
        }
        return r.result.value;
      },

      /**
       * Compose the frame: close every open application except `keepSelector`,
       * and clear notification toasts. Other modules' onboarding dialogs open
       * over the subject and document writes raise toasts that bleed into the
       * clip — both were hit on the first real capture. Returns what it closed
       * so a report can say so. Affects only this throwaway session's DOM.
       */
      async compose(keepSelector = null) {
        const keep = keepSelector ? keepSelector.replace(/^#/, "") : "";
        return JSON.parse(await api.eval(`(async () => {
          const closed = [];
          for (const app of foundry.applications.instances.values()) {
            if (${JSON.stringify(keep)} && app.id === ${JSON.stringify(keep)}) continue;
            try { closed.push(app.constructor.name); await app.close(); } catch {}
          }
          ui.notifications?.clear?.();
          document.querySelectorAll("#notifications .notification").forEach(n => n.remove());
          return JSON.stringify(closed);
        })()`));
      },

      /**
       * Capture to `file`. With a selector, clips to that element's box — which
       * is how §4b's "keep the machine out of frame" is actually enforced.
       * Creates the parent directory. Warns past the §4b ~300 KB ceiling.
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
        const shot = await cdp.send("Page.captureScreenshot",
          { format: "png", ...(clip ? { clip } : {}), captureBeyondViewport: false }, sessionId);
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
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
