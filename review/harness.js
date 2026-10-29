/* Review harness: serves the repo with python3 -m http.server, opens the board in Playwright,
   and answers every Supabase call (RPC over HTTP, Realtime over WebSocket) from a small
   in-memory fake backend. Nothing here talks to the real database.

   Fake backend rules (a guess at what the real app_* functions do, from how app.js calls them):
   - app_save_point upserts the row; if x.expect is non-null and the stored row's updated_at
     differs, it fails with "stale". A missing/null expect is an unconditional overwrite.
   - every successful write bumps updated_at and sends a Realtime "changed" broadcast to the
     OTHER open boards (what ping() does after a save).
   - per-RPC latency / failure / hang can be set with backend.net(fn, { req, res, fail, hang }). */
const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

// BOARD_ROOT lets verify-fixes.sh serve a patched copy instead of the repo.
const ROOT = process.env.BOARD_ROOT ? path.resolve(process.env.BOARD_ROOT) : path.resolve(__dirname, "..");
const SB = "https://hqlvhzrafntwqsktxljl.supabase.co";
const TOKEN = "tok";
const CODE = "1234";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = x => JSON.parse(JSON.stringify(x));
const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

async function startServer(port = 8765) {
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/version.json`); if (r.ok) break; } catch (e) {}
    await sleep(100);
  }
  return { url: `http://127.0.0.1:${port}/`, stop: () => proc.kill() };
}

// ---------- seed data ----------
function seed(opts = {}) {
  const W = ["Ava", "Bea", "Cleo", "Dina", "Eve", "Fay", "Gia", "Hana", "Iris", "Jo", "Kai"];
  const M = ["Abe", "Ben", "Cal", "Dev", "Eli", "Finn", "Gus", "Hal", "Ike", "Jay", "Kip", "Lou", "Max"];
  const players = [];
  W.forEach((n, i) => players.push({ id: "w" + i, name: n + " W" + i, nick: n, gender: "W", active: true, badge: i < 2 ? (i === 0 ? "C" : "P") : "" }));
  M.forEach((n, i) => players.push({ id: "m" + i, name: n + " M" + i, nick: n, gender: "M", active: true, badge: i < 4 ? "C" : "" }));
  const tour = { id: "t1", name: "Fall Classic", start_date: todayISO(), location: "Field 3", late: [], away: [] };
  const zone = { handlers: ["w2", "w3", "m4", "m5", "m6"], handlers_ok: ["w4", "m7"], deep: ["m8", "w5"], deep_ok: ["m9"], short: ["w6", "m10"], short_ok: ["w7"] };
  const games = [{ id: "g1", name: "vs Haverford", opponent: "", game_date: todayISO(), tournament_id: "t1", zone: {} }];
  const points = [];
  const lineups = opts.lineups || [];
  lineups.forEach((ids, i) => points.push({ id: "p" + (i + 1), game_id: "g1", pos: i + 1, lineup: ids.map(p => ({ p, r: "" })), plays: 1, outcomes: [], note: "", updated_at: new Date(Date.now() - 60000 + i).toISOString() }));
  return { team: { id: "team1", name: "Deep Blue", zone, pods: [] }, tournaments: [tour], players, games, points, practices: [] };
}

// ---------- fake backend ----------
function makeBackend(data) {
  const db = clone(data || seed());
  let clock = Date.now();
  const stamp = () => new Date(++clock).toISOString();
  const sockets = new Map();   // boardName -> ws route
  const log = [];
  const netRules = {};
  const err = msg => ({ status: 400, body: { code: "P0001", message: msg, details: null, hint: null } });

  function handle(fn, a) {
    const x = a || {};
    switch (fn) {
      case "app_load": return clone(db);
      case "app_save_point": {
        const row = clone(x.x || {}); const expect = row.expect; delete row.expect;
        const i = db.points.findIndex(p => p.id === row.id);
        if (expect != null && i >= 0 && db.points[i].updated_at !== expect) return err("stale");
        row.updated_at = stamp();
        if (i >= 0) db.points[i] = { ...db.points[i], ...row }; else db.points.push(row);
        return clone(row);
      }
      case "app_delete_point": db.points = db.points.filter(p => p.id !== x.p_id); return null;
      case "app_reorder_points": (x.p_ids || []).forEach((id, k) => { const p = db.points.find(q => q.id === id); if (p) { p.pos = k + 1; p.updated_at = stamp(); } }); return null;
      case "app_save_game": { const g = clone(x.g); const i = db.games.findIndex(y => y.id === g.id); if (i >= 0) db.games[i] = g; else db.games.push(g); return g; }
      case "app_delete_game": db.games = db.games.filter(g => g.id !== x.p_id); db.points = db.points.filter(p => p.game_id !== x.p_id); return null;
      case "app_save_player": { const p = clone(x.p); const i = db.players.findIndex(y => y.id === p.id); if (i >= 0) db.players[i] = p; else db.players.push(p); return p; }
      case "app_delete_player": db.players = db.players.filter(p => p.id !== x.p_id); return null;
      case "app_save_tournament": { const t = clone(x.x); const i = db.tournaments.findIndex(y => y.id === t.id); if (i >= 0) db.tournaments[i] = { ...db.tournaments[i], ...t }; else db.tournaments.push(t); return t; }
      case "app_delete_tournament": db.tournaments = db.tournaments.filter(t => t.id !== x.p_id); db.games.forEach(g => { if (g.tournament_id === x.p_id) g.tournament_id = null; }); return null;
      case "app_tournament_going_mark": {
        const t = db.tournaments.find(y => y.id === x.p_id); if (!t) return err("no tournament");
        t.late = (t.late || []).filter(id => id !== x.p_player); t.away = (t.away || []).filter(id => id !== x.p_player);
        if (x.p_state === "late") t.late.push(x.p_player); if (x.p_state === "away") t.away.push(x.p_player);
        return { late: clone(t.late), away: clone(t.away) };
      }
      case "app_save_practice": { const p = clone(x.x); const i = db.practices.findIndex(y => y.id === p.id); if (i >= 0) db.practices[i] = { ...db.practices[i], ...p }; else db.practices.push(p); return p; }
      case "app_practice_mark": { const p = db.practices.find(y => y.id === x.p_id); if (!p) return err("no practice"); p.attended = (p.attended || []).filter(id => id !== x.p_player); if (x.p_on) p.attended.push(x.p_player); return clone(p.attended); }
      case "app_practice_sit_mark": { const p = db.practices.find(y => y.id === x.p_id); if (!p) return err("no practice"); p.sitting = (p.sitting || []).filter(id => id !== x.p_player); if (x.p_on) p.sitting.push(x.p_player); return clone(p.sitting); }
      case "app_delete_practice": db.practices = db.practices.filter(p => p.id !== x.p_id); return null;
      case "app_save_team_zone": db.team.zone = clone(x.z); return null;
      case "app_save_team_pods": db.team.pods = clone(x.p); return null;
      case "app_owner_load": return err("bad_owner_code");
      case "app_owner_save": return err("bad_owner_code");
      case "app_set_code": return null;
      default: return err("unknown rpc " + fn);
    }
  }

  async function attach(page, name) {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.route(SB + "/rest/v1/rpc/**", async route => {
      const fn = route.request().url().split("/rpc/")[1].split("?")[0];
      let args = {}; try { args = JSON.parse(route.request().postData() || "{}"); } catch (e) {}
      const rule = { ...(netRules["*"] || {}), ...(netRules[fn] || {}) };
      const forBoard = rule.board ? rule.board === name : true;
      const entry = { board: name, fn, args, t: Date.now() };
      log.push(entry);
      if (forBoard && rule.hang) { entry.hung = true; return; }            // never answer
      if (forBoard && rule.req) await sleep(rule.req);                     // request still travelling
      if (forBoard && rule.fail) { entry.failed = true; return route.abort("internetdisconnected"); }
      if (args.p_code !== CODE) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "bad_code" }) });
      const out = handle(fn, args);
      entry.applied = Date.now();
      if (forBoard && rule.res) await sleep(rule.res);                     // response travelling back
      if (out && out.status === 400) { entry.error = out.body.message; return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify(out.body) }); }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out === undefined ? null : out) });
      if (fn !== "app_load" && fn !== "app_owner_load") broadcast(name);
    });
    // Realtime: answer the Phoenix join + heartbeats so the board shows "Live".
    await page.routeWebSocket(/realtime\/v1\/websocket/, ws => {
      sockets.set(name, ws);
      ws.onMessage(m => {
        if (typeof m !== "string") return;   // binary = a broadcast push from the page; the RPC hook already relays
        let f; try { f = JSON.parse(m); } catch (e) { return; }
        const [jref, ref, topic, event] = f;
        if (event === "phx_join") ws.send(JSON.stringify([jref, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: [] } }]));
        else if (event === "heartbeat" || event === "access_token" || event === "phx_leave") ws.send(JSON.stringify([jref, ref, topic, "phx_reply", { status: "ok", response: {} }]));
        else if (event === "broadcast") ws.send(JSON.stringify([jref, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      });
    });
  }
  function broadcast(from) {
    for (const [name, ws] of sockets) {
      if (name === from) continue;
      try { ws.send(JSON.stringify([null, null, "realtime:board-" + TOKEN, "broadcast", { type: "broadcast", event: "changed", payload: { at: Date.now() } }])); } catch (e) {}
    }
  }
  return {
    db, log, attach,
    net(fn, rule) { if (rule) netRules[fn] = rule; else delete netRules[fn]; },
    clearNet() { Object.keys(netRules).forEach(k => delete netRules[k]); },
    point: id => db.points.find(p => p.id === id),
    gamePoints: gid => db.points.filter(p => p.game_id === gid).sort((a, b) => a.pos - b.pos),
  };
}

// Open one board ("phone" by default: 390x844 with touch).
async function openBoard(browser, backend, server, o = {}) {
  const name = o.name || "A";
  const ctx = await browser.newContext({
    viewport: o.viewport || { width: 390, height: 844 },
    hasTouch: o.touch !== false, isMobile: o.mobile !== false, deviceScaleFactor: 2,
    userAgent: o.ua,
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => (page.errors = page.errors || []).push(String(e)));
  await backend.attach(page, name);
  await page.addInitScript(({ token, code, extra }) => {
    const k = s => "deepblue:" + token + ":" + s;
    if (!localStorage.getItem(k("code"))) {
      localStorage.setItem(k("code"), JSON.stringify(code));
      localStorage.setItem(k("tab"), JSON.stringify("points"));
      localStorage.setItem(k("game"), JSON.stringify("g1"));
      localStorage.setItem(k("seenVersion"), JSON.stringify("2026.10.29.1"));
      Object.entries(extra || {}).forEach(([a, b]) => localStorage.setItem(k(a), JSON.stringify(b)));
    }
  }, { token: TOKEN, code: CODE, extra: { sharks: o.sharks ?? false, ascii: o.ascii ?? false, ...(o.store || {}) } });
  await page.goto(server.url + (o.path || "") + "?t=" + TOKEN);
  await page.waitForSelector("#main", { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector("#sync")?.classList.contains("live"), null, { timeout: 8000 }).catch(() => {});
  page.ctx = ctx;
  return page;
}

// Ask a board to reload from the server the way it does on a Realtime ping / focus.
const nudge = page => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const lineNames = page => page.$$eval("#pointsTrack .point .tile .who .nm", els => els.map(e => e.textContent.trim()));

function report(title, ok, detail) {
  console.log(`${ok ? "REPRODUCED" : "not reproduced"}: ${title}`);
  if (detail) console.log("  " + (typeof detail === "string" ? detail : JSON.stringify(detail)));
  return ok;
}

module.exports = { startServer, seed, makeBackend, openBoard, nudge, settle, lineNames, report, sleep, clone, todayISO, chromium, TOKEN, CODE };
