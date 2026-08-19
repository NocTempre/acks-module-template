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
 * (below) affects only this session's DOM. No world documents are written.
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
 *     const { id, sel } = JSON.parse(await api.eval(`(async () => {
 *       const a = await Actor.create({ name: "Snapshot Fixture — Inn", type: "acks-extras.location" });
 *       await a.sheet.render(true);
 *       return JSON.stringify({ id: a.id, sel: "#" + a.sheet.id });
 *     })()`));
 *     await sleep(2000);
 *     await api.compose(sel);                    // sweep anything the write popped up
 *     console.log(await api.shot("docs/releases/v0.3.0/location-sheet.png", sel));
 *     console.log(await api.eval(`(async () => {  // destroy the fixture, prove it
 *       const a = game.actors.get("${id}"); if (a) await a.delete();
 *       return game.actors.get("${id}") ? "STILL PRESENT" : "deleted";
 *     })()`));
 *   } finally { api.close(); }
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

      close: cleanup,
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
