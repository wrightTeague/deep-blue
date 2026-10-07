/* Deep Blue Board: shared point planner + stats.
   Data lives in Supabase. The browser never touches tables directly; every read and
   write goes through app_* functions that check the team link token and passcode. */
(function () {
  "use strict";

  const SUPABASE_URL = "https://hqlvhzrafntwqsktxljl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_RxdiFg2zzl4aYnH92hQ6-g_ZACvuXLc";
  const APP_VERSION = "2026.10.07.4"; // keep in sync with version.json and the ?v= in index.html
  const SLOTS = 7;
  const ROLES = ["", "H", "C"];
  const ROLE_NAME = { H: "Handle", C: "Cut" };
  const BADGES = ["", "C", "P"];
  const BADGE_NAME = { C: "Captain", P: "President" };
  const ZONES = [["handlers", "Handlers"], ["deep", "Deep deep"], ["short", "Short deep"]];   // each also has a "<key>_ok" list: can play it if needed
  const zoneName = k => { const ok = /_ok$/.test(k), z = ZONES.find(x => x[0] === k.replace(/_ok$/, "")); return z ? z[1] + (ok ? " (if needed)" : "") : ""; };

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const TOKEN = (new URLSearchParams(location.search).get("t") || "").trim();

  // ---------- small helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
  const key = k => "deepblue:" + TOKEN + ":" + k;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(key(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(key(k)); } catch (e) {} },
  };
  function toast(msg, ms) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms || 2200);
  }

  // ---------- state ----------
  let CODE = store.get("code", "");
  let OWNER = store.get("owner", "");  // private settings code, only on this device
  let S = { team: null, tournaments: [], players: [], games: [], points: [], practices: [] };
  const ui = { tab: ((t => t === "zone" ? "roster" : t)(store.get("tab", "home"))), gameId: store.get("game", null), stats: { scope: "game", sort: "pts" }, sheet: null, sync: "connecting", rosterFilter: "" };
  let pending = 0, refreshQueued = false;
  // Copied line players, kept on this device so they can be pasted into any game.
  ui.clip = store.get("clip", null);   // { lineup:[{p,r}], from:"Line 3 · vs Susquehanna" }
  ui.undo = null;                      // { id, lineup } for the last paste
  ui.owner = null;                     // { rookies, apart, together } once unlocked with the private code
  ui.auto = null;                      // last auto-fill, for Undo: { changed:[{id,lineup}], created:[id], text }
  ui.pairing = store.get("pairing", "rotate");   // Fill lines captain pairs: "rotate", "usual" or "rest"
  ui.useAtt = store.get("useAtt", true);           // Fill lines: practice attendance nudges who goes out first
  ui.lateMode = store.get("lateMode", "start");    // Fill lines, late sign-ups: "start" (start later) or "less" (start later, play a bit less)
  ui.practiceId = null;                            // practice open for check-in
  ui.scrim = null;                                 // { pid, A: [ids], B: [ids] } scrim teams for that practice (this phone only)
  ui.pickSort = store.get("pickSort", "sat"); // player picker order for lines: "sat" (most lines sat first), "played" (fewest lines first) or "az"

  const P = id => S.players.find(p => p.id === id);
  const label = p => p ? (p.nick || p.name) : "?";
  const badge = p => p && p.badge ? `<span class="badge" title="${BADGE_NAME[p.badge]}" aria-label="${BADGE_NAME[p.badge]}">${p.badge}</span>` : "";
  const game = () => S.games.find(g => g.id === ui.gameId) || null;
  const tours = () => S.tournaments || [];
  const tourOf = g => g && g.tournament_id ? tours().find(t => t.id === g.tournament_id) || null : null;
  const gamePoints = gid => S.points.filter(x => x.game_id === gid).sort((a, b) => a.pos - b.pos);
  const activePlayers = () => S.players.filter(p => p.active);
  const sortPlayers = list => list.slice().sort((a, b) => (a.gender === b.gender ? 0 : a.gender === "W" ? -1 : b.gender === "W" ? 1 : 0) || label(a).localeCompare(label(b)));

  function upsertLocal(kind, row) {
    const arr = S[kind], i = arr.findIndex(r => r.id === row.id);
    if (i >= 0) arr[i] = { ...arr[i], ...row }; else arr.push(row);
  }
  function removeLocal(kind, id) { S[kind] = S[kind].filter(r => r.id !== id); }

  // ---------- server ----------
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, { p_token: TOKEN, p_code: CODE, ...(args || {}) });
    if (error) {
      const e = new Error(error.message || "Request failed");
      e.code = /bad_code/.test(error.message || "") ? "bad_code" : error.code || "error";
      throw e;
    }
    return data;
  }

  async function load(first) {
    try {
      const d = await rpc("app_load");
      S = { team: d.team, tournaments: d.tournaments || [], players: d.players || [], games: d.games || [], points: d.points || [], practices: d.practices || [] };
      serverLines.clear(); S.points.forEach(x => serverLines.set(x.id, JSON.parse(JSON.stringify(x))));
      store.set("cache", S);
      if (!game()) ui.gameId = S.games.length ? S.games[S.games.length - 1].id : null;
      if (first) { connect(); if (OWNER) loadOwner(); }
      render();
      return true;
    } catch (e) {
      if (e.code === "bad_code") {
        CODE = ""; store.del("code");
        renderGate("That passcode didn't work. Check with your captain.");
        return false;
      }
      const cached = store.get("cache", null);
      if (cached && !S.team) { S = cached; if (!game() && S.games.length) ui.gameId = S.games[S.games.length - 1].id; }
      setSync("offline");
      if (S.team) render(); else renderGate("Couldn't reach the board. Check your connection and try again.");
      if (first && S.team) connect();
      return false;
    }
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(async function go() {
      if (pending > 0) { setTimeout(go, 400); return; }
      refreshQueued = false;
      await load(false);
    }, 350);
  }

  // Live updates: every save sends a tiny "changed" ping on a channel named after the
  // team link; other open boards hear it and reload.
  let channel = null;
  function connect() {
    if (channel) return;
    channel = sb.channel("board-" + TOKEN, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "changed" }, () => scheduleRefresh())
      .subscribe(status => {
        if (status === "SUBSCRIBED") setSync("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setSync("offline");
      });
  }
  function ping() { try { channel && channel.send({ type: "broadcast", event: "changed", payload: { at: Date.now() } }); } catch (e) {} }

  async function save(fn, args, optimistic) {
    if (optimistic) optimistic();
    render();
    pending++;
    try {
      const row = await rpc(fn, args);
      ping();
      setSync("live");
      return row;
    } catch (e) {
      if (e.code === "bad_code") { CODE = ""; store.del("code"); renderGate("The team passcode changed. Enter the new one."); return null; }
      setSync("offline");
      toast("Couldn't save. Check your connection.", 3500);
      scheduleRefresh();
      return null;
    } finally { pending--; }
  }

  // The last copy of each line the server confirmed. Edits are applied on top of it, so two
  // phones changing the same line at once both keep their change (see patchPoint).
  const serverLines = new Map();
  const confirmLine = row => { if (!row || !row.id) return; serverLines.set(row.id, JSON.parse(JSON.stringify(row))); const cur = S.points.find(p => p.id === row.id); if (cur) cur.updated_at = row.updated_at; };
  const savePoint = pt => save("app_save_point", { x: pt }, () => upsertLocal("points", pt)).then(row => { confirmLine(row); return row; });
  const saveGame = g => save("app_save_game", { g }, () => upsertLocal("games", g));
  const savePlayer = p => save("app_save_player", { p }, () => upsertLocal("players", p));

  function setSync(s) {
    ui.sync = s;
    const el = $("#sync");
    if (el) { el.className = "sync " + s; el.lastElementChild.textContent = s === "live" ? "Live" : s === "offline" ? "Offline" : "Connecting"; }
  }

  // ---------- derived ----------
  const playsOf = pt => Math.max(1, Math.min(4, +pt.plays || 2));
  // One entry per point this line plays: { start_on, result, scorer, assist }
  function outs(pt) {
    const n = playsOf(pt), o = Array.isArray(pt.outcomes) ? pt.outcomes : [];
    return Array.from({ length: n }, (_, k) => ({ start_on: "", result: "", scorer: null, assist: null, ...(o[k] || {}) }));
  }
  function outcomeTag(o) {
    if (!o.result) return null;
    if (o.result === "us") return o.start_on === "D" ? { cls: "break", text: "Break" } : o.start_on === "O" ? { cls: "hold", text: "Hold" } : { cls: "hold", text: "Scored" };
    return o.start_on === "O" ? { cls: "lost", text: "Broken" } : { cls: "lost", text: "They scored" };
  }
  function computeStats(lines) {
    const rows = new Map(), team = { us: 0, them: 0, holds: 0, breaks: 0, oPts: 0, dPts: 0, played: 0 };
    const row = id => { if (!rows.has(id)) rows.set(id, { id, pts: 0, o: 0, d: 0, g: 0, a: 0 }); return rows.get(id); };
    lines.forEach(pt => outs(pt).forEach(o => {
      if (!o.result) return;
      team.played++;
      if (o.start_on === "O") team.oPts++; else if (o.start_on === "D") team.dPts++;
      if (o.result === "us") { team.us++; if (o.start_on === "O") team.holds++; if (o.start_on === "D") team.breaks++; }
      else team.them++;
      (pt.lineup || []).forEach(s => { const r = row(s.p); r.pts++; if (o.start_on === "O") r.o++; else if (o.start_on === "D") r.d++; });
      if (o.result === "us") { if (o.scorer) row(o.scorer).g++; if (o.assist && o.assist !== "none") row(o.assist).a++; }
    }));
    return { team, rows: [...rows.values()] };
  }
  // Planned points per player for a game: every line they're on counts for the points it plays.
  function plannedPoints(lines) {
    const m = new Map();
    lines.forEach(pt => (pt.lineup || []).forEach(s => m.set(s.p, (m.get(s.p) || 0) + playsOf(pt))));
    return m;
  }
  // The game played just before g on the same day of the same tournament (games come back in play
  // order). Resting carries over from it, so the first line of a game knows who just came off.
  // Every game played earlier the same day in the same tournament, in order.
  function dayGamesBefore(g) {
    if (!g) return [];
    const i = S.games.findIndex(x => x.id === g.id);
    return S.games.slice(0, Math.max(i, 0)).filter(p => (p.tournament_id || null) === (g.tournament_id || null) && (p.game_date || null) === (g.game_date || null));
  }
  function prevGameOf(g) {
    if (!g) return null;
    const i = S.games.findIndex(x => x.id === g.id), p = i > 0 ? S.games[i - 1] : null;
    return p && (p.tournament_id || null) === (g.tournament_id || null) && (p.game_date || null) === (g.game_date || null) ? p : null;
  }
  // How long each player has sat going into line idx of a game, and how many lines they've
  // played in it so far. Within the game it counts the planned points of the lines in between;
  // before that it carries over from the previous game, counting only points that got a result.
  // info(id) → { pts, lines, played }; pts/lines are null if they haven't played this game or last.
  function restBefore(lines, idx, prevLines) {
    const last = new Map(), played = new Map();   // id → { pt, line } where their last line ended
    let pt = 0, line = 0;
    const carried = !!(prevLines && prevLines.length);
    (prevLines || []).forEach(l => {
      const n = outs(l).filter(o => o.result).length; if (!n) return;
      pt += n; line++; (l.lineup || []).forEach(s => last.set(s.p, { pt, line }));
    });
    const prevPts = pt;
    for (let i = 0; i < idx; i++) {
      pt += playsOf(lines[i]); line++;
      (lines[i].lineup || []).forEach(s => { last.set(s.p, { pt, line }); played.set(s.p, (played.get(s.p) || 0) + 1); });
    }
    return {
      // Worth showing once anything has happened: an earlier line this game or a previous game.
      any: idx > 0 || (carried && prevPts > 0),
      info: id => { const e = last.get(id); return { pts: e ? pt - e.pt : null, lines: e ? line - e.line : null, played: played.get(id) || 0 }; },
    };
  }
  const restFor = (g, lines, idx) => { const pg = prevGameOf(g); return restBefore(lines, idx, pg ? gamePoints(pg.id) : null); };

  // ---------- render: shell ----------
  const TABS = [["home", "Home"], ["points", "Points"], ["practice", "Practice"], ["stats", "Stats"], ["roster", "Roster"]];   // zone spots live on Roster now

  function render() {
    if (!S.team) return;
    if (ui.drag) { ui.drag.pending = true; return; }   // never redraw under a finger mid-drag
    const app = $("#app");
    const active = document.activeElement;
    const keep = active && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const tabsHTML = TABS.map(([k, t]) => `<button data-act="tab" data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ""}>${t}</button>`).join("");
    const opt = (g, withDate) => `<option value="${g.id}" ${g.id === ui.gameId ? "selected" : ""}>${esc(g.name)}${withDate && g.game_date ? " · " + fmtDate(g.game_date) : ""}</option>`;
    const loose = S.games.filter(g => !tourOf(g));
    const gameOpts = tours().map(t => { const gs = S.games.filter(g => g.tournament_id === t.id); return gs.length ? `<optgroup label="${esc(t.name)}">${gs.map(g => opt(g, false)).join("")}</optgroup>` : ""; }).join("")
      + (loose.length ? (tours().length ? `<optgroup label="Other games">${loose.map(g => opt(g, true)).join("")}</optgroup>` : loose.map(g => opt(g, true)).join("")) : "");
    // Mid-swipe redraws (every save redraws) keep the line the swipe has reached.
    const oldTrack = trackOf();
    if (oldTrack && ui.swipe && ui.swipe.game === ui.gameId && swipeMode()) { const st = cardStep(oldTrack); if (st > 0) ui.swipe.i = clampLine(oldTrack, oldTrack.scrollLeft / st); }
    app.innerHTML = `
      <header class="top"><div class="top-in">
        <button class="brand" data-act="tab" data-tab="home" aria-label="Deep Blue, go to Home">Deep Blue</button>
        <div class="game-pick"${ui.tab === "points" || ui.tab === "stats" ? "" : " hidden"}>
          ${S.games.length ? `<select id="gameSel" aria-label="Game">${gameOpts}</select>` : `<span class="muted">No games yet</span>`}
          <button class="icon-btn" data-act="game-menu" aria-label="Game options">⋯</button>
        </div>
        <nav class="tabs" aria-label="Sections">${tabsHTML}</nav>
        <span class="sync ${ui.sync}" id="sync"><i></i><span>${ui.sync === "live" ? "Live" : ui.sync === "offline" ? "Offline" : "Connecting"}</span></span>
        <span class="ver" title="Board version">v${esc(APP_VERSION.replace(/^(test\.|\d{4}\.)/, ""))}</span>
      </div></header>
      <main id="main">${ui.tab === "stats" ? renderStats() : ui.tab === "roster" ? renderRoster() : ui.tab === "practice" ? renderPractice() : ui.tab === "home" ? renderHome() : renderPoints()}</main>
      ${ui.tab !== "points" ? "" : ui.editLines ? editBar() : ui.undoDel ? undoDelBar() : ui.auto ? autoBar() : ui.clip ? clipBar() : ""}
      <nav class="bottom-nav" aria-label="Sections">${tabsHTML}</nav>`;
    renderSheet();
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch (e) {} } }
    if (ui.tab === "points") afterPoints();
  }

  // ---------- phone swipe between lines ----------
  // ui.swipe = { game, i }: which card each phone is looking at, kept across re-renders (every
  // save re-draws the page). A new game opens on the NOW line. After a line is finished
  // (ui.advanceTo set by the result / assist taps) it slides on to the next one.
  function trackOf() { return document.getElementById("pointsTrack"); }
  function cardStep(t) { const c = t.children[0]; if (!c) return 0; const gap = parseFloat(getComputedStyle(t).columnGap) || 0; return c.getBoundingClientRect().width + gap; }
  function clampLine(t, i) { const n = t.children.length - 1; return Number.isFinite(i) ? Math.max(0, Math.min(Math.round(i), n)) : 0; }
  function showLine(i, smooth) {
    const t = trackOf(); if (!t) return;
    i = clampLine(t, i);
    ui.swipe = { game: ui.gameId, i };
    const step = cardStep(t);
    if (swipeMode() && step > 0) t.scrollTo({ left: i * step, behavior: smooth ? "smooth" : "instant" });
    paintPager(i, i);
  }
  // i = the line being shown; pos = exact swipe position (e.g. 2.4 while moving from line 3 to 4).
  // Runs every frame while swiping, so the dots, "Line X of Y" and the height keep up.
  function paintPager(i, pos) {
    const t = trackOf(); if (!t) return;
    const kids = t.children, n = kids.length - 1;
    if (swipeMode()) {
      // Tall enough for both lines in view mid-swipe, so nothing below shows over them.
      const a = kids[clampLine(t, Math.floor(pos))], b = kids[clampLine(t, Math.ceil(pos))];
      const h = Math.max(a ? a.offsetHeight : 0, b ? b.offsetHeight : 0);
      t.style.height = h ? (h + 12) + "px" : "";
    } else t.style.height = "";
    if (paintPager.track === t && paintPager.last === i) return;
    paintPager.track = t; paintPager.last = i;
    const txt = document.getElementById("pagerText");
    if (txt) txt.textContent = i >= n ? "New line" : `Line ${i + 1} of ${n}`;
    document.querySelectorAll("#lineDots .dot").forEach((d, k) => d.setAttribute("aria-current", k === i ? "true" : "false"));
  }
  function afterPoints() {
    const t = trackOf(); if (!t) return;
    const top = document.querySelector(".top"); if (top) document.documentElement.style.setProperty("--top-h", top.offsetHeight + "px");
    const g = game(), lines = g ? gamePoints(g.id) : [], now = nowPoint(lines);
    if (!ui.swipe || ui.swipe.game !== ui.gameId || !Number.isFinite(ui.swipe.i)) ui.swipe = { game: ui.gameId, i: now ? now.line : Math.max(lines.length - 1, 0) };
    showLine(ui.swipe.i, false);
    if (ui.advanceTo != null) { const to = ui.advanceTo; ui.advanceTo = null; if (swipeMode()) setTimeout(() => { showLine(to, true); setTimeout(nowRowToMiddle, 350); }, 700); }
    let raf = 0;
    t.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!t.isConnected || !swipeMode()) return;   // this copy was replaced by a redraw
        const step = cardStep(t); if (!(step > 0)) return;
        const pos = t.scrollLeft / step, i = clampLine(t, pos);
        ui.swipe = { game: ui.gameId, i };
        paintPager(i, pos);
      });
    }, { passive: true });
  }
  // Scroll the page (up or down only) so the NOW row sits in the middle of the screen.
  function nowRowToMiddle() {
    const r = document.getElementById("nowRow"); if (!r) return;
    const box = r.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + box.top - (window.innerHeight - box.height) / 2), behavior: "smooth" });
  }
  function jumpNow() {
    const g = game(), now = g ? nowPoint(gamePoints(g.id)) : null; if (!now) return;
    if (swipeMode()) { showLine(now.line, true); setTimeout(nowRowToMiddle, 350); }
    else nowRowToMiddle();
  }
  // Call before a tap that may finish a line; call the returned function after it.
  function watchFinish(lineId) {
    const before = S.points.find(x => x.id === lineId), was = before ? lineFinished(before) : true;
    return () => {
      const pt = S.points.find(x => x.id === lineId); if (!pt || was || !lineFinished(pt)) return;
      const i = gamePoints(pt.game_id).findIndex(x => x.id === lineId);
      ui.advanceTo = i + 1; render();
    };
  }

  function fmtDate(d) {
    const [y, m, day] = String(d).split("-").map(Number);
    if (!y) return "";
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function noGame() {
    return `<h2 class="sec">No game yet</h2><p class="empty-note">Make a game to start planning lines.</p><button class="btn primary" data-act="new-game">New game</button>`;
  }

  // ---------- render: points ----------
  // The point we're on: the first point in the game without a result.
  // → { line: index, k: point within the line, n: point number } or null when every point has one.
  function nowPoint(lines) {
    let n = 0;
    for (let i = 0; i < lines.length; i++) { const o = outs(lines[i]); for (let k = 0; k < o.length; k++) { n++; if (!o[k].result) return { line: i, k, n }; } }
    return null;
  }
  // A line is finished once every point has a result and every goal has its scorer and assist.
  const lineFinished = pt => outs(pt).every(o => o.result && (o.result !== "us" || (o.scorer && o.assist)));
  // Phones show one line at a time and swipe sideways; laptops keep the grid.
  const swipeMode = () => matchMedia("(max-width:759px)").matches;

  function renderPoints() {
    const g = game(); if (!g) return noGame();
    if (ui.editLines) return renderEditLines(g);
    const lines = gamePoints(g.id), st = computeStats(lines).team, now = nowPoint(lines);
    let next = 1;
    const cards = lines.map((pt, i) => { const from = next; next += playsOf(pt); return lineCard(pt, i, from, restFor(g, lines, i), now && now.line === i ? now.k : -1); }).join("");
    const total = lines.length + 1, dots = Array.from({ length: total }, (_, i) => `<button class="dot${i === lines.length ? " add" : ""}${now && now.line === i ? " now" : ""}" data-act="go-line" data-i="${i}" aria-label="${i === lines.length ? "Add a line" : "Line " + (i + 1)}"></button>`).join("");
    return `
      <div class="game-head">
        <div>${tourOf(g) ? `<p class="eyebrow">${esc(tourOf(g).name)}${g.game_date ? " · " + fmtDate(g.game_date) : ""}</p>` : ""}<h2 class="sec">${esc(g.name)}</h2></div>
        <div class="score">${st.us}–${st.them}<small>${st.holds} holds · ${st.breaks} breaks</small></div>
      </div>
      <div class="legend" style="margin-bottom:12px">
        <span class="row" style="gap:5px"><span class="role" data-r="H">H</span>Handle</span>
        <span class="row" style="gap:5px"><span class="role" data-r="C">C</span>Cut</span>
        <span>Tap a letter to change a role, a name to swap.</span>
      </div>
      <div class="line-nav">
        <div class="pager"><button class="icon-btn" data-act="go-line" data-dir="-1" aria-label="Previous line">‹</button><span class="pager-text" id="pagerText">Line 1 of ${lines.length}</span><button class="icon-btn" data-act="go-line" data-dir="1" aria-label="Next line">›</button></div>
        ${now ? `<button class="now-btn" data-act="jump-now">Now: Pt ${now.n}</button>` : (lines.length ? `<span class="now-done">Every point has a result</span>` : "")}
        <div class="dots" id="lineDots">${dots}</div>
      </div>
      <div class="points" id="pointsTrack">${cards}<div class="add-wrap"><button class="add-point" data-act="add-point">+ Add line</button>${ui.clip ? '<button class="add-point paste" data-act="paste-new">+ Paste as new line</button>' : ""}</div></div>
      ${pointsChart(lines)}`;
  }

  function clipBar() {
    const names = ui.clip.lineup.map(x => label(P(x.p))).join(", ");
    return `<div class="clipbar" role="status">
      <span class="clip-text"><b>Copied ${esc(ui.clip.from)}</b> ${esc(names) || "(no players)"}</span>
      <span class="row" style="gap:6px;flex-wrap:nowrap">
        ${ui.undo ? '<button class="btn sm" data-act="undo-paste">Undo</button>' : ""}
        <button class="btn sm" data-act="clip-done">Done</button>
      </span>
    </div>`;
  }

  function lineCard(pt, i, from, rest, nowK) {
    const line = pt.lineup || [], o = outs(pt), n = o.length, to = from + n - 1;
    let w = 0, m = 0; line.forEach(s => { const p = P(s.p); if (p?.gender === "W") w++; else if (p?.gender === "M") m++; });
    // Who the line maker thinks plays deep deep and short deep on this line (a suggestion, not saved).
    const zs = zoneSets(), spots = DBLines.assignSpots(line.map(s => s.p), zs);
    const listed = k => zs[k].main.size + zs[k].ok.size > 0;
    const posTag = id => id === spots.deep ? '<span class="pos dd" title="Deep deep">DD</span>' : id === spots.short ? '<span class="pos sd" title="Short deep">SD</span>' : "";
    const missing = line.length ? [listed("deep") && !spots.deep ? "no DD" : "", listed("short") && !spots.short ? "no SD" : ""].filter(Boolean) : [];
    const goals = new Map(), assists = new Map();
    o.forEach(x => { if (x.result === "us") { if (x.scorer) goals.set(x.scorer, (goals.get(x.scorer) || 0) + 1); if (x.assist && x.assist !== "none") assists.set(x.assist, (assists.get(x.assist) || 0) + 1); } });
    const slots = [];
    for (let k = 0; k < SLOTS; k++) {
      const s = line[k];
      if (s) {
        const p = P(s.p), r = s.r === "P" ? "C" : (s.r || "");
        const gN = goals.get(s.p) || 0, aN = assists.get(s.p) || 0;
        const ball = (gN || aN) ? `<span class="ball">${[gN ? (gN > 1 ? gN + " " : "") + "G" : "", aN ? (aN > 1 ? aN + " " : "") + "A" : ""].filter(Boolean).join(" · ")}</span>` : "";
        const sat = rest && rest.any ? rest.info(s.p).pts : undefined;
        const restTag = sat === undefined ? "" : sat === null ? `<span class="rest">1st shift</span>` : sat === 0 ? `<span class="rest b2b">back to back</span>` : `<span class="rest">sat ${sat} pt${sat === 1 ? "" : "s"}</span>`;
        slots.push(`<li class="slot">
          <button class="role" data-r="${r}" data-act="role" data-id="${pt.id}" data-k="${k}" aria-label="Role: ${ROLE_NAME[r] || "none"}. Tap to change">${r || "–"}</button>
          <button class="who" data-act="pick-slot" data-id="${pt.id}" data-k="${k}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span><span class="nm">${esc(label(p))}${badge(p)}</span>${posTag(s.p)}<span class="who-r">${ball}${restTag}</span></button>
        </li>`);
      } else {
        slots.push(`<li class="slot"><span class="role" aria-hidden="true"></span><button class="who empty" data-act="pick-slot" data-id="${pt.id}" data-k="${k}">+ Add player</button></li>`);
      }
    }
    const pickRow = (k, act, prompt, exclude, extra) => `<div class="ga-pick"><span class="ga-q">${prompt}</span>
      <div class="ga-opts">${line.filter(s => s.p !== exclude).map(s => { const p = P(s.p); return `<button class="ga-btn" data-act="${act}" data-id="${pt.id}" data-k="${k}" data-p="${s.p}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span>${esc(label(p))}</button>`; }).join("")}${extra || ""}</div></div>`;
    const scorerUI = (x, k) => {
      if (!x.scorer) return pickRow(k, "set-goal", "Who scored?", null, "");
      if (!x.assist) return pickRow(k, "set-assist", `Goal: <b>${esc(label(P(x.scorer)))}</b>. Who threw it?`, x.scorer, `<button class="ga-btn ghost" data-act="set-assist" data-id="${pt.id}" data-k="${k}" data-p="none">No assist</button>`);
      return `<div class="ga-done"><span>Goal <b>${esc(label(P(x.scorer)))}</b>${x.assist !== "none" ? ` · Assist <b>${esc(label(P(x.assist)))}</b>` : " · no assist"}</span>
        <button class="btn sm ghost" data-act="ga-change" data-id="${pt.id}" data-k="${k}">Change</button></div>`;
    };
    const rows = o.map((x, k) => {
      const tag = outcomeTag(x);
      return `<div class="pt-row${k === nowK ? " now" : ""}"${k === nowK ? ' id="nowRow"' : ""}>
        <div class="pt-line">
          ${k === nowK ? '<span class="now-pill">NOW</span>' : ""}<span class="pt-n">Pt ${from + k}</span>
          <div class="seg" role="group" aria-label="Point ${from + k}: start on offense or defense">
            <button data-act="od" data-id="${pt.id}" data-k="${k}" data-v="O" aria-pressed="${x.start_on === "O"}">O</button>
            <button data-act="od" data-id="${pt.id}" data-k="${k}" data-v="D" aria-pressed="${x.start_on === "D"}">D</button>
          </div>
          <div class="seg" role="group" aria-label="Point ${from + k}: result">
            <button class="us" data-act="result" data-id="${pt.id}" data-k="${k}" data-v="us" aria-pressed="${x.result === "us"}">We scored</button>
            <button class="them" data-act="result" data-id="${pt.id}" data-k="${k}" data-v="them" aria-pressed="${x.result === "them"}">They did</button>
          </div>
          ${tag ? `<span class="tag ${tag.cls}">${tag.text}</span>` : ""}
        </div>
        ${x.result === "us" ? (line.length ? scorerUI(x, k) : '<p class="muted" style="margin:0;font-size:14px">Add players to record the goal.</p>') : ""}
      </div>`;
    }).join("");
    const done = o.every(x => x.result);
    return `<article class="point ${done ? "done" : ""}${nowK >= 0 ? " current" : ""}" data-line="${i}">
      <div class="point-head">
        <h3>Line ${i + 1}</h3>
        <span class="tag">${n === 1 ? "Pt " + from : "Pts " + from + "–" + to}</span>
        ${ui.clip ? `<button class="btn sm primary" data-act="paste-line" data-id="${pt.id}">Paste</button>` : ""}
        <button class="icon-btn" data-act="point-menu" data-id="${pt.id}" aria-label="Line ${i + 1} options">⋯</button>
      </div>
      <ul class="slots">${slots.join("")}</ul>
      <div class="point-foot">
        <span class="counts"><span>${line.length}/${SLOTS}</span><span class="cw">${w} W</span><span class="cm">${m} M</span>${missing.map(t => `<span class="nopos">${t}</span>`).join("")}</span>
        ${rows}
      </div>
    </article>`;
  }

  // Grouped bar chart: how many players are planned for 0, 2, 4… points this game.
  // Each bar is split W / M. Tap (or hover on a laptop) to see who's in it.
  function pointsChart(lines) {
    const planned = plannedPoints(lines), people = activePlayers();
    if (!lines.length || !people.length) return "";
    const byCount = new Map();
    people.forEach(p => { const v = planned.get(p.id) || 0; if (!byCount.has(v)) byCount.set(v, []); byCount.get(v).push(p); });
    let groups = [...byCount.keys()].sort((a, b) => a - b).map(v => ({ key: String(v), name: v + (v === 1 ? " pt" : " pts"), players: byCount.get(v) }));
    if (groups.length > 6) {
      // Too many distinct counts: fold into 5 even ranges.
      const max = Math.max(...byCount.keys()), size = Math.ceil((max + 1) / 5), bins = [];
      for (let lo = 0; lo <= max; lo += size) {
        const hi = Math.min(lo + size - 1, max), ps = people.filter(p => { const v = planned.get(p.id) || 0; return v >= lo && v <= hi; });
        if (ps.length) bins.push({ key: lo + "-" + hi, name: lo === hi ? lo + " pts" : lo + "–" + hi + " pts", players: ps });
      }
      groups = bins;
    }
    const biggest = Math.max(...groups.map(gr => gr.players.length));
    const rows = groups.map(gr => {
      const ps = sortPlayers(gr.players), w = ps.filter(p => p.gender === "W").length, m = ps.filter(p => p.gender === "M").length, u = ps.length - w - m;
      const seg = (n, cls) => n ? `<span class="seg-fill ${cls}" style="flex-grow:${n}"></span>` : "";
      const open = ui.openBucket === gr.key;
      const names = ps.map(p => `<span class="nchip"><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span>${esc(label(p))}${badge(p)}</span>`).join("");
      return `<div class="bucket ${open ? "open" : ""}">
        <button class="bar-row" data-act="bucket" data-k="${gr.key}" aria-expanded="${open}">
          <span class="bl">${gr.name}</span>
          <span class="track"><span class="stack" style="width:${(ps.length / biggest) * 100}%">${seg(w, "W")}${seg(m, "M")}${seg(u, "U")}</span></span>
          <span class="bv">${ps.length} <span class="bsub">${[w ? w + "W" : "", m ? m + "M" : ""].filter(Boolean).join(" · ")}</span></span>
        </button>
        <div class="who-list" ${open ? "" : "hidden"}>${names}</div>
        <div class="pop" aria-hidden="true">${names}</div>
      </div>`;
    }).join("");
    return `<section class="ppl">
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <h2 class="sec">Points per person</h2>
        <span class="legend"><span class="row" style="gap:5px"><span class="key W"></span>W</span><span class="row" style="gap:5px"><span class="key M"></span>M</span></span>
      </div>
      <p class="muted" style="margin:8px 0 12px;font-size:15px">How many players are planned for each number of points this game. Tap a bar to see who.</p>
      <div class="bars">${rows}</div>
    </section>`;
  }

  // ---------- zone spots ----------
  // Zone spots belong to the team and carry across every tournament until someone changes them.
  // g is ignored (kept so callers read the same as before).
  const zoneOf = g => (S.team && S.team.zone) || {};
  // Zone lists in the shape the line maker uses: { handlers: { main: Set, ok: Set }, deep, short }.
  const zoneSets = () => { const z = zoneOf(); return Object.fromEntries(ZONES.map(([k]) => [k, { main: new Set(z[k] || []), ok: new Set(z[k + "_ok"] || []) }])); };
  function saveZone(fn) {
    const next = JSON.parse(JSON.stringify(zoneOf()));
    ZONES.forEach(([k]) => { next[k] = next[k] || []; next[k + "_ok"] = next[k + "_ok"] || []; });
    fn(next);
    save("app_save_team_zone", { z: next }, () => { S.team.zone = next; });
  }
  function renderZone() {
    const z = zoneOf();
    const chips = (k, name) => (z[k] || []).map((id, i) => { const p = P(id); return `<div class="chip${/_ok$/.test(k) ? " backup" : ""}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span><span class="nm">${esc(label(p))}${badge(p)}</span><button class="icon-btn" data-act="zone-remove" data-z="${k}" data-i="${i}" aria-label="Remove ${esc(label(p))} from ${name}">×</button></div>`; }).join("");
    const cols = ZONES.map(([k, name]) => `<section class="zone-col"><h3>${name}</h3>
        ${chips(k, name) || '<p class="empty-note">Nobody yet.</p>'}<button class="btn sm" data-act="zone-add" data-z="${k}" style="align-self:flex-start">+ Add</button>
        <h4 class="zone-ok">Can play it if needed</h4>
        ${chips(k + "_ok", name) || '<p class="empty-note">Nobody yet.</p>'}<button class="btn sm ghost" data-act="zone-add" data-z="${k}_ok" style="align-self:flex-start">+ Add backup</button>
      </section>`).join("");
    return `<section class="zone-sec"><h2 class="sec">Zone spots</h2><p class="muted" style="margin:8px 0 0">The same for every game and tournament until you change them. The line maker gives every line 2 handlers, a deep deep and a short deep, using backups only when nobody on the main list fits. Anyone can play cup.</p><div class="zone-grid">${cols}</div></section>`;
  }

  // ---------- practice: check-in, attendance, scrim teams ----------
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const practices = () => (S.practices || []).slice().sort((a, b) => (a.practice_date < b.practice_date ? -1 : a.practice_date > b.practice_date ? 1 : 0));
  const isLead = p => p && (p.badge === "C" || p.badge === "P");
  // Attendance counts practices after the last tournament before `date` (up to and including
  // `date`). tourId is the tournament the lines are for, so it never counts as "the last one".
  // → { since: tournament or null, list: practices, n, count: Map id → practices attended }
  function attendanceFor(date, tourId) {
    date = date || todayISO();
    const since = tours().filter(t => t.start_date && t.start_date < date && t.id !== tourId).sort((a, b) => (a.start_date < b.start_date ? -1 : 1)).pop() || null;
    const list = practices().filter(x => x.practice_date <= date && (!since || x.practice_date > since.start_date));
    const count = new Map();
    list.forEach(x => (x.attended || []).forEach(id => count.set(id, (count.get(id) || 0) + 1)));
    return { since, list, n: list.length, count };
  }
  // Attendance window for a game: the practices leading up to its tournament.
  const attendanceForGame = g => { const t = tourOf(g); return attendanceFor((t && t.start_date) || (g && g.game_date) || todayISO(), t ? t.id : null); };
  const lateOf = g => { const t = tourOf(g); return new Set((t && Array.isArray(t.late) ? t.late : []).filter(id => P(id))); };
  // Line-maker nudge from attendance, in "lines sat": +1 for someone who made every practice
  // versus a teammate who made none, centred on the team average. Captains and president
  // rotate on their own, so they're left out. Tuned so regulars get ~1–2 extra points a day.
  function attendancePriority(att) {
    if (!att.n) return {};
    const ps = activePlayers().filter(p => !isLead(p)); if (!ps.length) return {};
    const avg = ps.reduce((a, p) => a + (att.count.get(p.id) || 0), 0) / ps.length;
    return Object.fromEntries(ps.map(p => [p.id, ((att.count.get(p.id) || 0) - avg) / att.n]));
  }
  const sinceText = att => att.since ? `since ${esc(att.since.name)}${att.since.start_date ? " (" + fmtDate(att.since.start_date) + ")" : ""}` : "so far";

  // Scrim teams: captains split evenly, then each matchup, then handlers and (if private
  // settings are unlocked) rookies spread out. People who check in later join the smaller side.
  function scrimPlace(teams, p) {
    const rk = ui.owner ? new Set(ui.owner.rookies) : new Set(), hz = new Set(zoneOf().handlers || []);
    const cat = x => (isLead(x) ? "L" : hz.has(x.id) ? "H" : rk.has(x.id) ? "R" : "");
    const score = side => { const ps = teams[side].map(P).filter(Boolean);
      return (isLead(p) ? 10 : 1) * ps.filter(x => cat(x) === cat(p) && cat(p)).length + 3 * ps.filter(x => (x.gender || "") === (p.gender || "")).length + ps.length * 0.5; };
    const a = score("A"), b = score("B");
    teams[a < b ? "A" : b < a ? "B" : Math.random() < 0.5 ? "A" : "B"].push(p.id);
  }
  function scrimSplit(ids) {
    const rk = ui.owner ? new Set(ui.owner.rookies) : new Set(), hz = new Set(zoneOf().handlers || []);
    const ps = ids.map(P).filter(Boolean).map(p => ({ p, r: Math.random() }));
    const rank = p => (isLead(p) ? 0 : hz.has(p.id) ? 1 : rk.has(p.id) ? 2 : 3);
    ps.sort((x, y) => rank(x.p) - rank(y.p) || x.r - y.r);
    const teams = { A: [], B: [] }; ps.forEach(({ p }) => scrimPlace(teams, p));
    return teams;
  }
  // Checked in and not marked "left early / not scrimming".
  const scrimmers = pr => { const out = new Set(pr.sitting || []); return (pr.attended || []).filter(id => P(id) && !out.has(id)); };
  function scrimSync(pr) {
    const s = ui.scrim; if (!s || s.pid !== pr.id) return null;
    const here = new Set(scrimmers(pr));
    s.A = s.A.filter(id => here.has(id)); s.B = s.B.filter(id => here.has(id));
    here.forEach(id => { if (!s.A.includes(id) && !s.B.includes(id)) scrimPlace(s, P(id)); });
    return s;
  }

  function renderPractice() {
    const today = todayISO(), all = practices(), att = attendanceFor(today, null);
    const pr = ui.practiceId ? all.find(x => x.id === ui.practiceId) : null;
    if (ui.practiceId && !pr) ui.practiceId = null;
    const todays = all.find(x => x.practice_date === today);
    const people = sortPlayers(activePlayers());
    let open = "";
    if (pr) {
      const here = new Set((pr.attended || []).filter(id => P(id))), sitting = new Set((pr.sitting || []).filter(id => here.has(id)));
      const hp = people.filter(p => here.has(p.id)), w = hp.filter(p => p.gender === "W").length, m = hp.filter(p => p.gender === "M").length;
      const sitMode = ui.prMode === "sit";
      const chip = p => `<button class="tchip chk ${p.gender || "U"}${sitting.has(p.id) ? " sitting" : ""}" data-act="pr-mark" data-p="${p.id}" aria-pressed="${here.has(p.id)}"${sitMode && !here.has(p.id) ? " disabled" : ""}><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span>${esc(label(p))}${badge(p)}${sitting.has(p.id) ? '<span class="sit-tag">out</span>' : ""}</button>`;
      const grp = (gnd, t) => { const list = people.filter(p => (p.gender || "") === gnd); return list.length ? `<h4>${t}</h4><div class="tchips">${list.map(chip).join("")}</div>` : ""; };
      // Anyone checked in who's since been marked Out or removed still counts; show them too.
      const extra = (pr.attended || []).filter(id => P(id) && !P(id).active).map(P);
      const sc = scrimSync(pr);
      const team = (k, name) => { const ps = sortPlayers(sc[k].map(P).filter(Boolean)), tw = ps.filter(p => p.gender === "W").length, tm = ps.filter(p => p.gender === "M").length;
        return `<div class="scrim-team ${k}"><h4>${name} <span class="muted">${ps.length} · ${tw} W · ${tm} M</span></h4><div class="tchips">${ps.map(p => `<span class="nchip"><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span>${esc(label(p))}${badge(p)}</span>`).join("")}</div></div>`; };
      open = `<section class="card practice-open">
        <div class="row" style="justify-content:space-between;gap:8px">
          <h3>${pr.practice_date === today ? "Today's practice" : "Practice"}</h3>
          <button class="btn sm primary" data-act="pr-close">Done</button>
        </div>
        <div class="row" style="gap:10px"><input class="line-in" id="prDate" type="date" value="${esc(pr.practice_date)}" aria-label="Practice date"><span class="here-count"><b>${here.size} here</b> · ${w} W · ${m} M${sitting.size ? ` · <span class="sit-count">${sitting.size} not scrimming</span>` : ""}</span></div>
        <div class="seg pr-mode" role="group" aria-label="What a tap does"><button data-act="pr-mode" data-v="here" aria-pressed="${!sitMode}">Check in</button><button data-act="pr-mode" data-v="sit" aria-pressed="${sitMode}">Left early / not scrimming</button></div>
        <p class="muted" style="margin:0;font-size:14px">${sitMode ? "Tap anyone who left early or isn't scrimming. They stay checked in (it still counts as a practice) but are left off the scrim teams. Tap again to put them back." : "Tap everyone who's here. It saves as you go, and anyone else on the board sees it live."}</p>
        ${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}
        ${extra.length ? `<h4>Marked out, but checked in</h4><div class="tchips">${extra.map(chip).join("")}</div>` : ""}
        <div class="scrim-box">
          <div class="row" style="justify-content:space-between;gap:8px"><h4 style="margin:0">Scrim teams</h4>
            <span class="row" style="gap:6px">${sc ? '<button class="btn sm" data-act="scrim-make">Shuffle</button><button class="btn sm ghost" data-act="scrim-clear">Hide</button>' : `<button class="btn sm" data-act="scrim-make" ${here.size - sitting.size < 2 ? "disabled" : ""}>Split into 2 teams</button>`}</span></div>
          ${sc ? `<div class="scrim-teams">${team("A", "Dark")}${team("B", "Light")}</div><p class="muted" style="margin:0;font-size:13px">Even women and men, captains split, handlers spread out. People who check in later join the smaller side; anyone marked not scrimming drops off. Only on this phone.</p>` : `<p class="muted" style="margin:0;font-size:14px">Even women and men on each side, captains split up.</p>`}
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn sm danger ghost" data-act="pr-delete">${ui.prConfirm === pr.id ? "Tap again to delete this practice" : "Delete practice"}</button></div>
      </section>`;
    }
    const counts = people.map(p => ({ p, n: att.count.get(p.id) || 0 })).sort((a, b) => b.n - a.n || label(a.p).localeCompare(label(b.p)));
    const attRows = counts.map(({ p, n }) => `<div class="att-row"><span class="pl"><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span>${esc(label(p))}${badge(p)}</span><span class="att-bar"><i style="width:${att.n ? (n / att.n) * 100 : 0}%"></i></span><span class="att-n">${n}/${att.n}</span></div>`).join("");
    const inWin = new Set(att.list.map(x => x.id));
    const prRow = x => { const n = (x.attended || []).filter(id => P(id)).length; return `<li><button data-act="pr-open" data-id="${x.id}" ${x.id === ui.practiceId ? 'aria-current="true"' : ""}><span>${fmtDate(x.practice_date)}${x.practice_date === today ? " · today" : ""}</span><span class="meta">${n} here</span></button></li>`; };
    const recent = all.filter(x => inWin.has(x.id)).reverse(), older = all.filter(x => !inWin.has(x.id)).reverse();
    return `<h2 class="sec">Practice</h2>
      ${pr ? "" : `<div class="row" style="margin:8px 0 14px"><button class="btn primary" data-act="pr-new">${todays ? "Open today's check-in" : "Check in today's practice"}</button><button class="btn ghost" data-act="pr-new-date">Add an earlier practice</button></div>`}
      ${open}
      <section class="card att-card">
        <h3>Attendance <span class="muted">${sinceText(att)} · ${att.n} practice${att.n === 1 ? "" : "s"}</span></h3>
        <p class="muted" style="margin:0;font-size:14px">Fill lines can use this: the best attendance starts the tournament and gets a little more time. It resets after each tournament.</p>
        ${att.n ? `<div class="att-list">${attRows}</div>` : '<p class="empty-note">No practices checked in yet.</p>'}
      </section>
      ${all.length ? `<section class="card"><h3>Practices</h3><ul class="pr-list">${recent.map(prRow).join("")}</ul>${older.length ? `<h4 class="muted">Before ${esc(att.since ? att.since.name : "")}</h4><ul class="pr-list">${older.map(prRow).join("")}</ul>` : ""}</section>` : ""}`;
  }
  async function newPractice(date) {
    const ex = practices().find(x => x.practice_date === date);
    if (ex) { ui.practiceId = ex.id; render(); return; }
    const x = { id: uid(), practice_date: date, attended: [], note: "" };
    ui.practiceId = x.id; ui.scrim = null;
    await save("app_save_practice", { x }, () => { S.practices = [...(S.practices || []), x]; });
  }
  const markWaiting = new Map();
  async function markPractice(pid, player) {
    const pr = (S.practices || []).find(x => x.id === pid); if (!pr) return;
    const on = !(pr.attended || []).includes(player);
    markWaiting.set(pid, (markWaiting.get(pid) || 0) + 1);
    const v = await save("app_practice_mark", { p_id: pid, p_player: player, p_on: on }, () => { pr.attended = on ? [...(pr.attended || []), player] : (pr.attended || []).filter(id => id !== player); });
    if (!on && (pr.sitting || []).includes(player)) markSitting(pid, player);   // not here at all now
    const left = markWaiting.get(pid) - 1; markWaiting.set(pid, left);
    if (!left && Array.isArray(v)) { const cur = (S.practices || []).find(x => x.id === pid); if (cur) { cur.attended = v; render(); } }
  }
  async function markSitting(pid, player) {
    const pr = (S.practices || []).find(x => x.id === pid); if (!pr) return;
    const cur = pr.sitting || [], on = !cur.includes(player);
    if (on && !(pr.attended || []).includes(player)) return;   // only people who are here can sit out
    const v = await save("app_practice_sit_mark", { p_id: pid, p_player: player, p_on: on }, () => { pr.sitting = on ? [...cur, player] : cur.filter(id => id !== player); });
    if (Array.isArray(v)) { const x = (S.practices || []).find(y => y.id === pid); if (x) { x.sitting = v; render(); } }
  }
  async function markLate(tid, player) {
    const t = tours().find(x => x.id === tid); if (!t) return;
    const late = Array.isArray(t.late) ? t.late : [], on = !late.includes(player);
    const v = await save("app_tournament_late_mark", { p_id: tid, p_player: player, p_on: on }, () => { t.late = on ? [...late, player] : late.filter(id => id !== player); });
    if (Array.isArray(v)) { t.late = v; renderSheet(); }
  }

  // ---------- home: what's next, the season's tournaments, recent games ----------
  const daysUntil = d => { const [y, m, day] = String(d).split("-").map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, day) - t) / 86400000); };
  const fmtDay = d => { const [y, m, day] = String(d).split("-").map(Number); return y ? new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ""; };
  const whenText = d => { const n = daysUntil(d); return n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 ? `in ${n} days` : n === -1 ? "yesterday" : `${-n} days ago`; };
  // Wins and losses from games with at least one result.
  function tourRecord(t) {
    let w = 0, l = 0, tie = 0, us = 0, them = 0;
    S.games.filter(g => g.tournament_id === t.id).forEach(g => { const s = computeStats(gamePoints(g.id)).team; if (!s.played) return; us += s.us; them += s.them; if (s.us > s.them) w++; else if (s.them > s.us) l++; else tie++; });
    return { w, l, tie, us, them, any: w + l + tie > 0 };
  }
  function renderHome() {
    const today = todayISO();
    const dated = tours().filter(t => t.start_date).sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
    const next = dated.find(t => t.start_date >= today) || null;
    const todays = practices().find(x => x.practice_date === today);
    const att = attendanceFor(today, null);
    let nextCard = "";
    if (next) {
      const late = (Array.isArray(next.late) ? next.late : []).filter(id => P(id)).length, games = S.games.filter(g => g.tournament_id === next.id).length;
      nextCard = `<section class="card home-next">
        <p class="eyebrow">Next up · ${whenText(next.start_date)}</p>
        <h3>${esc(next.name)}</h3>
        <p class="next-meta">${fmtDay(next.start_date)}${next.location ? ` · at ${esc(next.location)}` : ""}</p>
        <div class="row" style="gap:8px">
          <button class="btn primary sm" data-act="home-tour" data-id="${next.id}">${games ? "Open its games" : "Plan the first game"}</button>
          <button class="btn sm" data-act="home-late" data-id="${next.id}">Late sign-ups${late ? " (" + late + ")" : ""}</button>
          <button class="btn sm ghost" data-act="home-edit-tour" data-id="${next.id}">Edit</button>
        </div>
        <p class="muted" style="margin:0;font-size:14px">${att.n ? `${att.n} practice${att.n === 1 ? "" : "s"} ${sinceText(att)} ${att.n === 1 ? "counts" : "count"} toward who starts.` : `No practices checked in ${sinceText(att)} yet.`}</p>
      </section>`;
    }
    const row = t => {
      const past = t.start_date && t.start_date < today, r = tourRecord(t), n = S.games.filter(g => g.tournament_id === t.id).length;
      const status = r.any ? `<b>${r.w}–${r.l}</b> <span class="muted">(${r.us}–${r.them})</span>` : t.start_date ? (past ? `<span class="muted">${n ? n + " game" + (n === 1 ? "" : "s") : "no games"}</span>` : `<span class="soon">${whenText(t.start_date)}</span>`) : `<span class="muted">no date</span>`;
      return `<li class="${past ? "past" : ""}${next && t.id === next.id ? " is-next" : ""}"><button class="sched-open" data-act="home-tour" data-id="${t.id}">
          <span class="sched-date">${t.start_date ? fmtDate(t.start_date) : "—"}</span>
          <span class="sched-name">${esc(t.name)}${t.location ? `<small>at ${esc(t.location)}</small>` : ""}</span>
          <span class="sched-status">${status}</span></button>
        <button class="icon-btn" data-act="home-edit-tour" data-id="${t.id}" aria-label="Edit ${esc(t.name)}">✎</button></li>`;
    };
    const upcoming = dated.filter(t => t.start_date >= today), past = dated.filter(t => t.start_date < today).reverse(), undated = tours().filter(t => !t.start_date);
    const recent = S.games.map(g => ({ g, s: computeStats(gamePoints(g.id)).team })).filter(x => x.s.played).slice(-5).reverse();
    return `<h2 class="sec">Home</h2>
      ${nextCard}
      <section class="card home-practice">
        <div class="row" style="justify-content:space-between;gap:8px">
          <h3>Practice</h3>
          <button class="btn sm ${todays ? "" : "primary"}" data-act="home-practice">${todays ? `Today: ${(todays.attended || []).filter(id => P(id)).length} here` : "Check in today's practice"}</button>
        </div>
      </section>
      <section class="card">
        <div class="row" style="justify-content:space-between;gap:8px"><h3>Tournaments</h3><button class="btn sm" data-act="home-new-tour">+ Add tournament</button></div>
        ${upcoming.length ? `<h4 class="sched-h">Coming up</h4><ul class="sched">${upcoming.map(row).join("")}</ul>` : ""}
        ${past.length ? `<h4 class="sched-h">Played</h4><ul class="sched">${past.map(row).join("")}</ul>` : ""}
        ${undated.length ? `<h4 class="sched-h">No date yet</h4><ul class="sched">${undated.map(row).join("")}</ul>` : ""}
        ${tours().length ? "" : '<p class="empty-note">No tournaments yet.</p>'}
      </section>
      ${recent.length ? `<section class="card"><h3>Recent games</h3><ul class="pr-list">${recent.map(({ g, s }) => `<li><button data-act="home-game" data-id="${g.id}"><span>${esc(g.name)}${tourOf(g) ? ` <small class="muted">· ${esc(tourOf(g).name)}</small>` : ""}</span><span class="meta"><b class="${s.us > s.them ? "won" : s.them > s.us ? "lost" : ""}">${s.us}–${s.them}</b></span></button></li>`).join("")}</ul></section>` : ""}`;
  }
  // Removing a tournament: delete its games too, or keep them (they move to "Other games").
  function removeChoices(t, act, cls) {
    const n = S.games.filter(g => g.tournament_id === t.id).length;
    if (!n) return `<button class="${cls}danger" type="button" data-act="${act}" data-v="keep">Tap again to remove ${esc(t.name)}</button>`;
    return `<button class="${cls}danger" type="button" data-act="${act}" data-v="all">Delete ${esc(t.name)} and its ${n} game${n === 1 ? "" : "s"}</button>
      <button class="${cls}" type="button" data-act="${act}" data-v="keep">Remove ${esc(t.name)} but keep its games (they move to Other games)</button>`;
  }
  async function removeTour(tid, withGames) {
    if (!tid) return;
    if (withGames) {
      for (const g of S.games.filter(x => x.tournament_id === tid)) {
        await save("app_delete_game", { p_id: g.id }, () => { removeLocal("games", g.id); S.points = S.points.filter(x => x.game_id !== g.id); });
      }
      if (!game()) { ui.gameId = S.games.length ? S.games[S.games.length - 1].id : null; store.set("game", ui.gameId); ui.swipe = null; }
    }
    await save("app_delete_tournament", { p_id: tid }, () => { S.tournaments = tours().filter(t => t.id !== tid); S.games.forEach(g => { if (g.tournament_id === tid) g.tournament_id = null; }); });
    toast(withGames ? "Tournament and its games deleted" : "Tournament removed");
  }
  // Open a tournament: its most recent game on the Points tab, or name its first game.
  function openTour(tid) {
    const gs = S.games.filter(g => g.tournament_id === tid);
    if (!gs.length) { openSheet({ type: "game-form", tour: tid }); return; }
    openGame(gs[gs.length - 1].id);
  }
  function openGame(gid) {
    ui.gameId = gid; store.set("game", gid); ui.swipe = null; ui.editLines = null; ui.undoDel = null;
    ui.tab = "points"; store.set("tab", "points"); render(); window.scrollTo(0, 0);
  }

  // ---------- render: stats ----------
  function renderStats() {
    const scope = ui.stats.scope;
    const g = game();
    const t = tourOf(g), sc = scope === "tour" && !t ? "game" : scope;
    const pts = sc === "game" && g ? gamePoints(g.id) : sc === "tour" ? S.points.filter(x => { const gg = S.games.find(y => y.id === x.game_id); return gg && gg.tournament_id === t.id; }) : S.points.slice();
    const { team, rows } = computeStats(pts);
    const keyMap = { name: r => label(P(r.id)).toLowerCase(), pts: r => r.pts, o: r => r.o, d: r => r.d, g: r => r.g, a: r => r.a };
    const k = ui.stats.sort, f = keyMap[k] || keyMap.pts;
    rows.sort((x, y) => k === "name" ? f(x).localeCompare(f(y)) : (f(y) - f(x)) || (y.pts - x.pts));
    const th = (id, t) => `<th data-act="sort" data-k="${id}" ${k === id ? 'aria-sort="descending"' : ""}>${t}</th>`;
    const body = rows.map(r => { const p = P(r.id); return `<tr><td><span class="pl" title="${esc(p ? p.name : "")}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span>${esc(p ? label(p) : "Removed player")}${badge(p)}</span></td><td>${r.pts}</td><td>${r.o}</td><td>${r.d}</td><td>${r.g}</td><td>${r.a}</td></tr>`; }).join("");
    return `
      <div class="row" style="justify-content:space-between">
        <h2 class="sec">Stats</h2>
        <div class="seg" role="group" aria-label="Which games">
          <button data-act="stats-scope" data-v="game" aria-pressed="${sc === "game"}">This game</button>
          ${t ? `<button data-act="stats-scope" data-v="tour" aria-pressed="${sc === "tour"}">Tournament</button>` : ""}
          <button data-act="stats-scope" data-v="all" aria-pressed="${sc === "all"}">All games</button>
        </div>
      </div>
      <div class="team-line">
        <div><b>${team.us}–${team.them}</b><span>Score</span></div>
        <div><b>${team.holds}/${team.oPts}</b><span>Holds on O</span></div>
        <div><b>${team.breaks}/${team.dPts}</b><span>Breaks on D</span></div>
        <div><b>${team.played}</b><span>Points played</span></div>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="stats">
        <thead><tr>${th("name", "Player")}${th("pts", "Pts")}${th("o", "O")}${th("d", "D")}${th("g", "G")}${th("a", "A")}</tr></thead>
        <tbody>${body}</tbody></table></div>` : `<p class="empty-note">Stats appear once a point has a result. Tap "We scored" or "They did" on a point.</p>`}`;
  }

  // ---------- render: roster ----------
  function renderRoster() {
    const q = ui.rosterFilter.toLowerCase();
    const list = sortPlayers(S.players).filter(p => !q || p.name.toLowerCase().includes(q) || (p.nick || "").toLowerCase().includes(q));
    const grp = (gnd, title) => {
      const rows = list.filter(p => (p.gender || "") === gnd).map(p => `
        <div class="rp ${p.active ? "" : "inactive"}">
          <button class="gbtn" data-act="p-gender" data-id="${p.id}" aria-label="Matchup ${p.gender || "not set"}, tap to change"><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span></button>
          <input class="line-in" id="pn-${p.id}" data-act="p-name" data-id="${p.id}" value="${esc(p.name)}" aria-label="Full name">
          <input class="line-in" id="pk-${p.id}" data-act="p-nick" data-id="${p.id}" value="${esc(p.nick)}" placeholder="Nickname" aria-label="Nickname on the board">
          <button class="badge-btn ${p.badge ? "on" : ""}" data-act="p-badge" data-id="${p.id}" aria-label="${p.badge ? BADGE_NAME[p.badge] : "No captain or president badge"}, tap to change">${p.badge || "·"}</button>
          <button class="btn sm ghost" data-act="p-active" data-id="${p.id}">${p.active ? "Active" : "Out"}</button>
          <button class="icon-btn" data-act="p-delete" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">×</button>
        </div>`).join("");
      return rows ? `<section><h3 class="pick-group" style="padding-left:0">${title}</h3>${rows}</section>` : "";
    };
    const link = location.origin + location.pathname + "?t=" + TOKEN;
    return `
      <h2 class="sec">Roster</h2>
      <form class="add-form" id="addForm">
        <input class="line-in" id="addName" value="${esc(ui.addName || "")}" placeholder="Add a player (full name)" maxlength="60" style="flex:1;min-width:180px">
        <input class="line-in" id="addNick" value="${esc(ui.addNick || "")}" placeholder="Nickname" maxlength="30" style="width:110px">
        <div class="seg" role="group" aria-label="Matchup"><button type="button" data-act="add-g" data-v="W" aria-pressed="${ui.addG === "W"}">W</button><button type="button" data-act="add-g" data-v="M" aria-pressed="${ui.addG !== "W"}">M</button></div>
        <button class="btn primary sm" type="submit">Add</button>
      </form>
      <input class="line-in" id="rosterFilter" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search roster" value="${esc(ui.rosterFilter)}" style="width:100%;max-width:340px">
      <p class="muted" style="font-size:14px;margin:8px 0 0">The nickname is what shows on line cards. Tap the dot to mark a captain (C) or president (P). "Out" hides someone from the player picker without deleting their stats.</p>
      <div class="roster-cols">${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}</div>
      ${renderZone()}
      ${privateCard()}
      <div class="settings">
        <div class="card">
          <h3>Share the board</h3>
          <p class="muted" style="margin:0">Send teammates this link and the passcode separately. Anyone with both can view and edit.</p>
          <div class="mono" id="shareLink">${esc(link)}</div>
          <div class="row"><button class="btn sm" data-act="copy-link">Copy link</button></div>
        </div>
        <div class="card">
          <h3>Change passcode</h3>
          <form class="row" id="codeForm"><input class="line-in" id="newCode" placeholder="New passcode (4+ characters)" autocomplete="off" style="flex:1;min-width:180px"><button class="btn sm" type="submit">Change</button></form>
          <p class="muted" style="margin:0;font-size:14px">Everyone else will be asked for the new one.</p>
        </div>
        <div class="card">
          <h3>This device</h3>
          <div class="row"><button class="btn sm" data-act="logout">Forget passcode on this device</button></div>
        </div>
      </div>`;
  }

  // ---------- sheets (picker, menus, forms) ----------
  function openSheet(s) { ui.sheet = s; renderSheet(); setTimeout(() => { const f = $("#sheet-root [autofocus]"); if (f && matchMedia("(min-width:760px)").matches) f.focus(); }, 30); }
  function closeSheet() { const s = ui.sheet; ui.sheet = null; renderSheet(); if (s && s.type === "ratio" && s.resolve) s.resolve("keep"); setTimeout(() => { if (typeof checkVersion === "function") checkVersion(); }, 300); }

  function renderSheet() {
    const root = $("#sheet-root"), s = ui.sheet;
    if (!s) { root.innerHTML = ""; return; }
    let title = "", tools = "", body = "";
    if (s.type === "pick") {
      const g = game(), pts = g ? gamePoints(g.id) : [];
      const planned = plannedPoints(pts);
      let taken = new Set();
      if (s.pointId) { const pt = S.points.find(x => x.id === s.pointId); (pt?.lineup || []).forEach(x => taken.add(x.p)); }
      const zMain = s.zone ? s.zone.replace(/_ok$/, "") : "";
      if (s.zone) taken = new Set([...(zoneOf(g)[zMain] || []), ...(zoneOf(g)[zMain + "_ok"] || [])]);
      const q = (s.q || "").toLowerCase(), f = s.f || "";
      // Picking for a line (not a zone): show how long each person has sat and how many lines
      // they've played, and sort by either, once there's an earlier line or game to go on.
      const lineIdx = s.pointId && !s.zone ? pts.findIndex(x => x.id === s.pointId) : -1;
      let rest = lineIdx >= 0 ? restFor(g, pts, lineIdx) : null;
      if (rest && !rest.any) rest = null;
      const sortBy = !rest ? "az" : ui.pickSort === "played" || ui.pickSort === "az" ? ui.pickSort : "sat";
      const big = v => v === null ? Infinity : v;
      let list = sortPlayers(activePlayers()).filter(p => (!f || p.gender === f) && (!q || p.name.toLowerCase().includes(q) || (p.nick || "").toLowerCase().includes(q)));
      if (sortBy !== "az") {
        const I = new Map(list.map(p => [p.id, rest.info(p.id)]));
        const bySat = (a, b) => big(I.get(b.id).lines) - big(I.get(a.id).lines) || big(I.get(b.id).pts) - big(I.get(a.id).pts);
        list = list.sort(sortBy === "sat" ? bySat : (a, b) => I.get(a.id).played - I.get(b.id).played || bySat(a, b));
      }
      const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
      const restText = p => {
        const v = rest.info(p.id);
        if (v.pts === null) return `<b class="rest first">not in yet</b>`;
        const sat = v.pts === 0 ? `<span class="rest b2b">just played</span>` : `sat ${plural(v.lines, "line")} (${plural(v.pts, "pt")})`;
        return `${sat} · ${plural(v.played, "line")} played`;
      };
      const att = !s.zone && g ? attendanceForGame(g) : null, lateSet = !s.zone ? lateOf(g) : new Set();
      const attText = p => (att && att.n ? ` · <span class="att-mini">${att.count.get(p.id) || 0}/${att.n} practices</span>` : "") + (lateSet.has(p.id) ? ' · <span class="late-mini">late sign-up</span>' : "");
      const meta0 = p => s.zone && taken.has(p.id) ? ((zoneOf(g)[zMain] || []).includes(p.id) ? "main list" : "backup") : taken.has(p.id) ? "on it" : rest ? restText(p) : (planned.get(p.id) || 0) + " pts planned";
      const meta = p => meta0(p) + (taken.has(p.id) ? "" : attText(p));
      const item = p => `<li><button data-act="pick" data-p="${p.id}" ${taken.has(p.id) ? "disabled" : ""}><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span><span class="nm">${esc(p.name)}${badge(p)}</span><span class="meta">${meta(p)}</span></button></li>`;
      const sec = (gnd, t) => { const items = list.filter(p => (p.gender || "") === gnd).map(item).join(""); return items ? `<li class="pick-group">${t}</li>${items}` : ""; };
      title = s.zone ? "Add to " + zoneName(s.zone) : s.current ? "Swap " + esc(label(P(s.current))) : "Add player";
      tools = `<input class="line-in" id="pickQ" placeholder="Search" value="${esc(s.q || "")}" autofocus autocomplete="off">
        <div class="seg" role="group" aria-label="Filter"><button data-act="pick-f" data-v="" aria-pressed="${!f}">All</button><button data-act="pick-f" data-v="W" aria-pressed="${f === "W"}">W</button><button data-act="pick-f" data-v="M" aria-pressed="${f === "M"}">M</button></div>
        ${rest ? `<div class="seg" role="group" aria-label="Sort">${[["sat", "Lines sat"], ["played", "Lines played"], ["az", "A–Z"]].map(([v, t]) => `<button data-act="pick-sort" data-v="${v}" aria-pressed="${sortBy === v}">${t}</button>`).join("")}</div>` : ""}`;
      body = `${s.current ? `<div class="row" style="padding:2px 8px 8px"><button class="btn sm danger" data-act="pick-remove">Take ${esc(label(P(s.current)))} off this line</button></div>` : ""}
        <ul class="pick-list">${sec("W", "Women-matching")}${sec("M", "Men-matching")}${sec("", "Matchup not set")}</ul>
        ${list.length ? "" : '<p class="empty-note" style="padding:8px">Nobody matches.</p>'}`;
    } else if (s.type === "point-menu") {
      const pts = gamePoints(ui.gameId), i = pts.findIndex(x => x.id === s.id), cur = pts[i] ? playsOf(pts[i]) : 2;
      title = "Line " + (i + 1);
      body = `<div class="menu-list">
        <div class="row" style="padding:6px 12px 10px;gap:12px"><span>Plays</span>
          <div class="seg" role="group" aria-label="Points this line plays">${[1, 2, 3, 4].map(v => `<button data-act="pm-plays" data-v="${v}" aria-pressed="${cur === v}">${v}</button>`).join("")}</div>
          <span class="muted">point${cur === 1 ? "" : "s"}</span></div>
        ${pts[i] && !outs(pts[i]).some(o => o.result) && (pts[i].lineup || []).length < SLOTS ? '<button data-act="pm-suggest"><b>Suggest players for the empty spots</b></button>' : ""}
        <button data-act="pm-copy">Copy players (to paste into other lines or games)</button>
        <button data-act="pm-dup">Duplicate this line at the end</button>
        <button data-act="pm-insert">Insert a copy right after this line</button>
        ${i > 0 ? '<button data-act="pm-up">Move earlier</button>' : ""}
        ${i < pts.length - 1 ? '<button data-act="pm-down">Move later</button>' : ""}
        <button data-act="pm-clear-result">Clear results</button>
        <button data-act="pm-clear">Clear players</button>
        <button class="danger" data-act="pm-delete">${s.confirm ? "Tap again to delete Line " + (i + 1) : "Delete line"}</button>
      </div>`;
    } else if (s.type === "game-menu") {
      const g = game(), t = tourOf(g);
      title = g ? esc(g.name) : "Games";
      body = `<div class="menu-list">
        ${g ? '<button data-act="fill-open"><b>Fill lines automatically</b></button>' : ""}
        ${g && gamePoints(g.id).length ? '<button data-act="edit-lines"><b>Edit lines</b> (reorder or delete several)</button>' : ""}
        ${t ? `<button data-act="late-open">Late sign-ups for ${esc(t.name)}${lateOf(g).size ? " (" + lateOf(g).size + ")" : ""}</button>` : ""}
        ${t ? `<button data-act="copy-game">Next game in ${esc(t.name)} (copy these lines)</button>
        <button data-act="new-game-tour">New empty game in ${esc(t.name)}</button>` : ""}
        <button data-act="new-game">New game</button>
        <button data-act="new-tour">New tournament</button>
        ${g ? `<button data-act="edit-game">Edit game (name, date, tournament)</button>
        ${t ? "" : '<button data-act="copy-game">New game copying these lines</button>'}
        <button class="danger" data-act="delete-game">${s.confirm === "game" ? "Tap again to delete " + esc(g.name) + " and its lines" : "Delete game"}</button>` : ""}
        ${t ? `<button data-act="edit-tour">Edit ${esc(t.name)} (name, date, where)</button>
        ${s.confirm === "tour" ? removeChoices(t, "delete-tour", "") : '<button class="danger" data-act="delete-tour">Remove tournament</button>'}` : ""}
      </div>`;
    } else if (s.type === "game-form") {
      const g = s.id ? S.games.find(x => x.id === s.id) : null;
      const src = s.copyFrom ? S.games.find(x => x.id === s.copyFrom) : game();
      const tid = g ? (g.tournament_id || "") : (s.tour !== undefined ? s.tour : (src?.tournament_id || ""));
      const sameTour = src && src.tournament_id && src.tournament_id === tid;
      const date = g ? (g.game_date || "") : (tid ? ((sameTour && src.game_date) || tours().find(t => t.id === tid)?.start_date || "") : "");
      title = g ? "Edit game" : s.copyFrom ? "Next game (same lines)" : "New game";
      body = `<form class="form" id="gameForm">
        <label>Name<input class="line-in" id="gName" value="${esc(g ? g.name : "")}" placeholder="e.g. vs Haverford" maxlength="80" autofocus required></label>
        <label>Tournament<select class="line-in" id="gTour"><option value="">None</option>${tours().map(t => `<option value="${t.id}" ${t.id === tid ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        <label>Date<input class="line-in" id="gDate" type="date" value="${esc(date)}"></label>
        <div class="row"><button class="btn primary" type="submit">${g ? "Save" : "Create"}</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div>
      </form>`;
    } else if (s.type === "fill") {
      const g = game(), zz = zoneOf(g), zoneSet = ZONES.some(([k]) => (zz[k] || []).length || (zz[k + "_ok"] || []).length);
      title = "Fill lines";
      body = `<div class="form">
        <div class="row" style="gap:10px"><span>Add</span>
          <div class="seg" role="group" aria-label="New lines">${[0, 1, 2, 3, 4, 6].map(v => `<button data-act="fill-n" data-v="${v}" aria-pressed="${s.n === v}">${v}</button>`).join("")}</div><span>new lines</span></div>
        <div class="row" style="gap:10px"><span>Each plays</span>
          <div class="seg" role="group" aria-label="Points per new line">${[1, 2, 3].map(v => `<button data-act="fill-plays" data-v="${v}" aria-pressed="${s.plays === v}">${v}</button>`).join("")}</div><span>point${s.plays === 1 ? "" : "s"}</span></div>
        <div class="fill-pair"><span>Captain pairs</span>
          <div class="seg" role="group" aria-label="Captain pairs">${[["rotate", "Rotate"], ["usual", "Mostly usual"], ["rest", "Same pairs"]].map(([v, t]) => `<button data-act="fill-pairing" data-v="${v}" aria-pressed="${ui.pairing === v}">${t}</button>`).join("")}</div>
          <p class="muted fill-pair-note">${ui.pairing === "rotate" ? "Each captain goes out with whoever they've played with least today, so everyone plays with everyone."
            : ui.pairing === "usual" ? (() => { const up = DBLines.usualPairs(S.players, S.points); return up.length ? `Usual pairs two rounds out of three, then a mixed round: ${up.map(([a, b]) => esc(label(P(a))) + " + " + esc(label(P(b)))).join(" · ")}.` : "No usual pairs yet. Once captains have played together a few times, they'll show here."; })()
            : "Whoever has rested longest goes out together, so the same pairs tend to come back every few lines."}</p>
        </div>
        ${(() => { const att = attendanceForGame(g), late = lateOf(g);
          return `<div class="fill-pair"><span>Practice attendance</span>
          <label class="fill-check" style="margin:0"><input type="checkbox" id="fillAtt" data-act="fill-att" ${ui.useAtt ? "checked" : ""}><span>Best attendance starts and gets a little more time</span></label>
          <p class="muted fill-pair-note">${att.n ? `${att.n} practice${att.n === 1 ? "" : "s"} ${sinceText(att)}. Someone at every practice gets about 1–2 more points a day than average; someone at none, about that much less.` : `No practices checked in ${sinceText(att)}, so this does nothing yet.`}</p></div>
          ${late.size ? `<div class="fill-pair"><span>Late sign-ups (${late.size})</span>
          <div class="seg" role="group" aria-label="Late sign-ups">${[["start", "Start later"], ["less", "Start later + less time"]].map(([v, t]) => `<button data-act="fill-late" data-v="${v}" aria-pressed="${ui.lateMode === v}">${t}</button>`).join("")}</div>
          <p class="muted fill-pair-note">${ui.lateMode === "less" ? "They go out after everyone's first shift and play a couple fewer points over the day." : "They go out after everyone's first shift, then rotate like everyone else."} ${[...late].map(id => esc(label(P(id)))).join(", ")}.</p></div>` : ""}`; })()}
        <label class="fill-check"><input type="checkbox" id="fillExisting" ${s.existing ? "checked" : ""}><span>Also fill empty spots in lines that haven't been played</span></label>
        <ul class="fill-rules">
          <li>2 captains or president per line, whoever has rested longest goes first</li>
          <li>3 women and 4 men (asks first if the men fall a point behind over the day)</li>
          <li>${zoneSet ? "2 handlers, a deep deep and a short deep on every line, from Zone spots (backups only if needed)" : `<b>No zone spots set.</b> Add handlers, deep deeps and short deeps under Zone spots on the Roster tab.`}</li>
          <li>Nobody back to back, people out are skipped</li>
          ${ui.owner ? "<li>Using your private settings</li>" : ""}
          <li>Players you've already placed stay put. Lines with results aren't touched.</li>
        </ul>
        <div class="row"><button class="btn primary" data-act="fill-go">Fill</button><button class="btn ghost" data-act="close">Cancel</button></div>
      </div>`;
    } else if (s.type === "ratio") {
      title = "Men are sitting longer";
      body = `<div class="form">
        <p style="margin:0">So far today, not counting captains and president, men have played <b>${s.m.toFixed(1)} points</b> on average and women <b>${s.w.toFixed(1)}</b>.</p>
        <p style="margin:0">Make Line ${s.lineNo} <b>5 men / 2 women</b> to catch up?</p>
        <div class="row"><button class="btn primary" data-act="ratio-five">Yes, 5 men / 2 women</button><button class="btn" data-act="ratio-keep">Keep 4 men / 3 women</button></div>
      </div>`;
    } else if (s.type === "late") {
      const t = tours().find(x => x.id === s.tid);
      const late = new Set(t && Array.isArray(t.late) ? t.late : []), people = sortPlayers(activePlayers());
      title = "Late sign-ups";
      const chip = p => `<button class="tchip chk ${p.gender || "U"}" data-act="late-mark" data-p="${p.id}" aria-pressed="${late.has(p.id)}"><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span>${esc(label(p))}${badge(p)}</button>`;
      const grp = (gnd, h) => { const list = people.filter(p => (p.gender || "") === gnd); return list.length ? `<h4 style="margin:4px 0 0">${h}</h4><div class="tchips">${list.map(chip).join("")}</div>` : ""; };
      body = t ? `<div class="form">
        <p class="muted" style="margin:0">Tap everyone who signed up for <b>${esc(t.name)}</b> after the deadline. Fill lines starts them after everyone else has had a first shift${ui.lateMode === "less" ? ", and gives them a couple fewer points over the day" : ""}. (Change that in Fill lines.)</p>
        ${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}
        <div class="row"><button class="btn primary" data-act="close">Done</button></div></div>` : '<p class="empty-note">That tournament is gone.</p>';
    } else if (s.type === "pr-date") {
      title = "Add a practice";
      body = `<form class="form" id="prDateForm">
        <label>Date<input class="line-in" id="prNewDate" type="date" value="${esc(todayISO())}" max="${esc(todayISO())}" required autofocus></label>
        <div class="row"><button class="btn primary" type="submit">Add</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>`;
    } else if (s.type === "tour-form") {
      const t = s.id ? tours().find(x => x.id === s.id) : null;
      title = t ? "Edit tournament" : "New tournament";
      body = `<form class="form" id="tourForm">
        <label>Name<input class="line-in" id="tName" value="${esc(t ? t.name : "")}" placeholder="e.g. Haverford Hat" maxlength="80" autofocus required></label>
        <label>Date<input class="line-in" id="tDate" type="date" value="${esc(t?.start_date || "")}"></label>
        <label>Where<input class="line-in" id="tWhere" value="${esc(t?.location || "")}" placeholder="e.g. Susquehanna" maxlength="80"></label>
        ${t || s.home ? "" : '<p class="muted" style="margin:0;font-size:14px">Next you\'ll name its first game.</p>'}
        <div class="row"><button class="btn primary" type="submit">${t ? "Save" : "Create"}</button><button class="btn ghost" type="button" data-act="close">Cancel</button>
          ${t && !s.confirm ? '<button class="btn ghost danger" type="button" data-act="tour-del" style="margin-left:auto">Remove</button>' : ""}</div>
        ${t && s.confirm ? `<div class="remove-choices">${removeChoices(t, "tour-del", "btn ")}</div>` : ""}
      </form>`;
    }
    root.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${title.replace(/<[^>]+>/g, "")}">
      <div class="sheet-head"><h3>${title}</h3><button class="icon-btn" data-act="close" aria-label="Close">×</button></div>
      ${tools ? `<div class="sheet-tools">${tools}</div>` : ""}
      <div class="sheet-body">${body}</div></div></div>`;
  }

  // ---------- line maker ----------
  // Fills lines with DBLines.planLine (lines.js). opts: { only: lineId } for one line, or
  // { newLines, plays, existing } for the game. Never touches lines that have a result or
  // players already placed. Keeps what it changed so Undo can put it back.
  function askRatio(lineNo, mb) {
    return new Promise(resolve => openSheet({ type: "ratio", lineNo, w: mb.w, m: mb.m, resolve }));
  }
  async function autoFill(opts) {
    const g = game(); if (!g) return;
    const pg = prevGameOf(g), prevLines = pg ? gamePoints(pg.id) : null;
    const lines = gamePoints(g.id).map(x => JSON.parse(JSON.stringify(x)));
    const played = pt => outs(pt).some(o => o.result);
    const before = new Map(lines.map(x => [x.id, (x.lineup || []).map(s => ({ ...s }))]));
    let targets = [];
    if (opts.only) targets = lines.map((x, i) => i).filter(i => lines[i].id === opts.only && !played(lines[i]));
    else {
      if (opts.existing) targets = lines.map((x, i) => i).filter(i => !played(lines[i]) && (lines[i].lineup || []).length < SLOTS && !lines.slice(i + 1).some(played));
      for (let k = 0; k < (opts.newLines || 0); k++) {
        lines.push({ id: uid(), game_id: g.id, pos: lines.length + 1, lineup: [], plays: opts.plays || 2, outcomes: [], note: "" });
        targets.push(lines.length - 1);
      }
    }
    if (!targets.length) { toast("Nothing to fill: every line is full or already played."); return; }
    const o = ui.owner || { rookies: [], apart: [], together: [] };
    const notes = [], dayLines = dayGamesBefore(g).map(x => gamePoints(x.id)), usualPairs = DBLines.usualPairs(S.players, S.points);
    // Attendance nudge (lines.js tuning: +1 line sat for every practice vs none ≈ 1–2 points a day).
    const priority = ui.useAtt ? attendancePriority(attendanceForGame(g)) : {}, late = lateOf(g);
    for (const i of targets) {
      const mb = DBLines.menBehind({ players: S.players, lines, idx: i, dayLines });
      const ratio = mb.behind && (await askRatio(i + 1, mb)) === "five" ? { W: 2, M: 5 } : { W: 3, M: 4 };
      const keep = (lines[i].lineup || []).map(s => s.p), keepRoles = Object.fromEntries((lines[i].lineup || []).map(s => [s.p, s.r || ""]));
      const r = DBLines.planLine({
        players: S.players, lines, idx: i, prevLines, dayLines, keep, keepRoles, ratio, pairing: ui.pairing, usualPairs,
        positions: zoneSets(), rookies: new Set(o.rookies), apart: o.apart, together: o.together, seed: g.id + ":" + i,
        priority, late, lateLess: ui.lateMode === "less" ? 0.5 : 0,
      });
      lines[i].lineup = r.lineup;
      r.notes.forEach(n => notes.push(`Line ${i + 1}: ${n}`));
    }
    const created = [], changed = [];
    for (const i of targets) {
      const x = lines[i];
      if (before.has(x.id)) { changed.push({ id: x.id, lineup: before.get(x.id) }); const cur = S.points.find(p => p.id === x.id); await savePoint({ ...cur, lineup: x.lineup }); }
      else { created.push(x.id); await savePoint(x); }
    }
    const first = Math.min(...targets) + 1, last = Math.max(...targets) + 1;
    ui.auto = { changed, created, text: `Filled ${first === last ? "Line " + first : "Lines " + first + "–" + last}.`, notes };
    render();
    setTimeout(() => {
      if (swipeMode()) { showLine(first - 1, true); trackOf()?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      else document.querySelectorAll(".point")[first - 1]?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  }
  async function undoAuto() {
    const u = ui.auto; if (!u) return; ui.auto = null;
    for (const c of u.changed) { const cur = S.points.find(p => p.id === c.id); if (cur) await savePoint({ ...cur, lineup: c.lineup }); }
    for (const id of u.created) await save("app_delete_point", { p_id: id }, () => removeLocal("points", id));
    const g = game(); if (g && u.created.length) { const order = gamePoints(g.id).map(x => x.id); await save("app_reorder_points", { p_game: g.id, p_ids: order }, () => order.forEach((x, i) => { S.points.find(p => p.id === x).pos = i + 1; })); }
    render(); toast("Undone");
  }
  function autoBar() {
    const u = ui.auto;
    return `<div class="clipbar" role="status">
      <span class="clip-text"><b>${esc(u.text)}</b> ${u.notes.length ? esc(u.notes.join(" · ")) : "Swap anyone you want."}</span>
      <span class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-act="auto-undo">Undo</button><button class="btn sm" data-act="auto-done">Done</button></span>
    </div>`;
  }

  // ---------- private settings (only whoever has the private code) ----------
  // Private settings have no visible way in. Typing the private code into "Search roster" and
  // pressing Enter / Go tries it quietly: a wrong code just leaves the search as it was.
  async function loadOwner() {
    try {
      const d = await sb.rpc("app_owner_load", { p_token: TOKEN, p_code: CODE, p_owner: OWNER });
      if (d.error) throw d.error;
      ui.owner = { rookies: d.data.rookies || [], apart: toGroups(d.data.apart), together: toGroups(d.data.together) };
      store.set("owner", OWNER);
    } catch (e) {
      if (/bad_owner_code/.test((e && e.message) || "")) { OWNER = ""; store.del("owner"); }
      ui.owner = null;
    }
    render();
  }
  async function tryOwner(code) {
    if (!code || ui.owner) return false;
    const d = await sb.rpc("app_owner_load", { p_token: TOKEN, p_code: CODE, p_owner: code });
    if (d.error || !d.data) return false;
    OWNER = code; ui.owner = { rookies: d.data.rookies || [], apart: toGroups(d.data.apart), together: toGroups(d.data.together) };
    store.set("owner", OWNER); ui.rosterFilter = ""; render();
    setTimeout(() => document.querySelector(".card.private")?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
    return true;
  }
  // Keep apart / together are stored as one person and a list: [{ p, with: [ids] }].
  // Older plain pairs ([a, b]) get folded into that shape.
  function toGroups(list) {
    const out = [];
    (list || []).forEach(x => {
      const g = Array.isArray(x) ? { p: x[0], with: [x[1]] } : x && x.p ? { p: x.p, with: (x.with || []).slice() } : null;
      if (!g) return;
      const same = out.find(y => y.p === g.p);
      if (same) g.with.forEach(id => { if (!same.with.includes(id)) same.with.push(id); }); else out.push(g);
    });
    return out;
  }
  async function saveOwner() {
    render();
    const { error } = await sb.rpc("app_owner_save", { p_token: TOKEN, p_code: CODE, p_owner: OWNER, s: ui.owner });
    if (error) { toast("Couldn't save private settings", 3000); loadOwner(); }
  }
  function privateCard() {
    if (!ui.owner) return "";
    const people = sortPlayers(activePlayers()), rk = new Set(ui.owner.rookies);
    const opts = people.map(p => `<option value="${p.id}">${esc(label(p))}</option>`).join("");
    const groups = k => { const verb = k === "apart" ? "stays away from" : "goes with"; return `${ui.owner[k].map((g, i) => {
        const others = people.filter(p => p.id !== g.p && !g.with.includes(p.id)).map(p => `<option value="${p.id}">${esc(label(p))}</option>`).join("");
        return `<div class="grp">
          <div class="grp-head"><b>${esc(label(P(g.p)))}</b> <span class="muted">${verb}</span><button class="icon-btn" data-act="o-del" data-k="${k}" data-i="${i}" aria-label="Remove ${esc(label(P(g.p)))}'s list">×</button></div>
          <div class="grp-list">${g.with.map(id => `<span class="pair">${esc(label(P(id)))}<button class="icon-btn" data-act="o-unwith" data-k="${k}" data-i="${i}" data-p="${id}" aria-label="Remove ${esc(label(P(id)))}">×</button></span>`).join("")}
            <select class="line-in grp-add" data-act="o-with" data-k="${k}" data-i="${i}" aria-label="Add someone"><option value="">+ add someone</option>${others}</select></div>
        </div>`;
      }).join("") || '<span class="muted">Nobody yet.</span>'}
      <div class="row" style="gap:6px"><select class="line-in" id="${k}P"><option value="">Pick a person…</option>${opts}</select><button class="btn sm" data-act="o-add" data-k="${k}">Add</button></div>` };
    return `<section class="card private"><div class="row" style="justify-content:space-between"><h3>Private settings</h3><button class="btn sm ghost" data-act="o-lock">Lock</button></div>
      <p class="muted" style="margin:0">Only on devices where you've entered the private code. Nobody else sees these.</p>
      <h4>Rookies <span class="muted">(${rk.size})</span></h4>
      <p class="muted" style="margin:0;font-size:14px">The line maker spreads them out so no line is stacked with rookies.</p>
      <div class="tchips">${people.map(p => `<button class="tchip" data-act="o-rookie" data-id="${p.id}" aria-pressed="${rk.has(p.id)}">${esc(label(p))}</button>`).join("")}</div>
      <h4>Keep apart</h4><p class="muted" style="margin:0;font-size:14px">Pick a person, then everyone they shouldn't share a line with. Never broken.</p><div class="pairs">${groups("apart")}</div>
      <h4>Keep together</h4><p class="muted" style="margin:0;font-size:14px">Pick a person, then who should come with them. They come along when they fit.</p><div class="pairs">${groups("together")}</div>
    </section>`;
  }

  // ---------- edit lines: select several to delete, press-and-hold to drag into a new order ----------
  // ui.editLines = { sel: Set of line ids, confirm: bool }. ui.drag while a tile is being dragged.
  function renderEditLines(g) {
    const lines = gamePoints(g.id), sel = ui.editLines.sel;
    let next = 1;
    const tiles = lines.map((pt, i) => {
      const n = playsOf(pt), from = next; next += n;
      const o = outs(pt), played = o.some(x => x.result);
      const res = o.map(x => `<i class="r ${x.result === "us" ? "us" : x.result === "them" ? "them" : ""}"></i>`).join("");
      const names = (pt.lineup || []).map(x => { const p = P(x.p); return `<span class="${p?.gender || "U"}">${esc(label(p))}</span>`; }).join("");
      return `<article class="etile${sel.has(pt.id) ? " sel" : ""}${played ? " played" : ""}" data-id="${pt.id}" data-plays="${n}" aria-pressed="${sel.has(pt.id)}" tabindex="0">
        <div class="et-head"><b class="et-n">Line ${i + 1}</b><span class="et-pts">${n === 1 ? "Pt " + from : "Pts " + from + "–" + (from + n - 1)}</span><span class="et-check" aria-hidden="true"></span></div>
        <div class="et-res">${res}${played ? '<span class="et-played">played</span>' : ""}</div>
        <div class="et-names">${names || '<span class="muted">No players</span>'}</div>
      </article>`;
    }).join("");
    return `<div class="game-head"><div><p class="eyebrow">Edit lines</p><h2 class="sec">${esc(g.name)}</h2></div></div>
      <p class="muted edit-help">Tap lines to select them for deleting. Press and hold a line, then drag it to move it.</p>
      <div class="egrid" id="egrid">${tiles}</div>`;
  }
  function editBar() {
    const n = ui.editLines.sel.size, g = game();
    const playedSel = n ? gamePoints(g.id).filter(pt => ui.editLines.sel.has(pt.id) && outs(pt).some(o => o.result)).length : 0;
    const what = `${n} line${n === 1 ? "" : "s"}`;
    return `<div class="clipbar editbar" role="status">
      <span class="clip-text">${n ? `<b>${what} selected</b>${playedSel ? ` · ${playedSel} already played` : ""}` : "<b>Edit lines</b> Select lines or drag to reorder"}</span>
      <span class="row" style="gap:6px;flex-wrap:nowrap">
        ${n ? `<button class="btn sm danger" data-act="edit-delete">${ui.editLines.confirm ? "Tap again to delete " + what : "Delete " + what}</button>` : ""}
        <button class="btn sm primary" data-act="edit-done">Done</button>
      </span></div>`;
  }
  function undoDelBar() {
    return `<div class="clipbar" role="status"><span class="clip-text"><b>${esc(ui.undoDel.text)}</b></span>
      <span class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-act="undo-delete">Undo</button><button class="btn sm" data-act="undo-delete-done">Done</button></span></div>`;
  }
  async function deleteSelected() {
    const g = game(); if (!g) return;
    const before = gamePoints(g.id), ids = before.filter(pt => ui.editLines.sel.has(pt.id)).map(pt => pt.id);
    if (!ids.length) return;
    const rows = before.filter(pt => ids.includes(pt.id)).map(pt => JSON.parse(JSON.stringify(pt)));
    ui.undoDel = { gid: g.id, rows, order: before.map(pt => pt.id), text: `Deleted ${ids.length} line${ids.length === 1 ? "" : "s"}.` };
    ui.editLines = null; ui.swipe = null;
    for (const id of ids) await save("app_delete_point", { p_id: id }, () => removeLocal("points", id));
    const order = gamePoints(g.id).map(x => x.id);
    await save("app_reorder_points", { p_game: g.id, p_ids: order }, () => order.forEach((x, i) => { const p = S.points.find(q => q.id === x); if (p) p.pos = i + 1; }));
    render();
  }
  async function undoDelete() {
    const u = ui.undoDel; if (!u) return; ui.undoDel = null;
    for (const row of u.rows) await savePoint(row);
    const order = u.order.filter(id => S.points.some(p => p.id === id));
    await save("app_reorder_points", { p_game: u.gid, p_ids: order }, () => order.forEach((x, i) => { const p = S.points.find(q => q.id === x); if (p) p.pos = i + 1; }));
    render(); toast("Lines are back");
  }
  function saveOrder(order) {
    const g = game(); if (!g) return;
    save("app_reorder_points", { p_game: g.id, p_ids: order }, () => order.forEach((x, i) => { const p = S.points.find(q => q.id === x); if (p) p.pos = i + 1; }));
  }

  // Dragging: a mouse drags once it moves a few pixels; a finger has to rest on the tile for a
  // moment first, so a normal swipe still scrolls the page.
  (function setupDrag() {
    let press = null;   // { tile, id, x, y, timer, pointerId, touch }
    const HOLD = 280, SLOP = 8;
    const grid = () => document.getElementById("egrid");
    function start() {
      const t = press.tile, r = t.getBoundingClientRect();
      ui.drag = { id: press.id, tile: t, dx: press.x - r.left, dy: press.y - r.top, pending: false };
      t.style.transition = "none";
      t.classList.add("dragging"); grid()?.classList.add("is-dragging");
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
    }
    // Keep the dragged tile under the finger: measure its slot without the offset, then offset it.
    function place(x, y) {
      const t = ui.drag.tile; t.style.transform = "";
      const b = t.getBoundingClientRect();
      t.style.transform = `translate(${x - ui.drag.dx - b.left}px, ${y - ui.drag.dy - b.top}px)`;
    }
    function moveTo(x, y) {
      const d = ui.drag, gEl = grid(); if (!d || !gEl) return;
      // Move the tile's slot to whichever tile the finger is over.
      const over = [...gEl.children].find(el => { if (el === d.tile) return false; const b = el.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
      if (over) {
        const kids = [...gEl.children], from = kids.indexOf(d.tile), to = kids.indexOf(over);
        gEl.insertBefore(d.tile, from < to ? over.nextSibling : over);
        let from1 = 1;
        [...gEl.children].forEach((el, k) => {
          const n = +el.dataset.plays || 1, nEl = el.querySelector(".et-n"), pEl = el.querySelector(".et-pts");
          if (nEl) nEl.textContent = "Line " + (k + 1);
          if (pEl) pEl.textContent = n === 1 ? "Pt " + from1 : "Pts " + from1 + "–" + (from1 + n - 1);
          from1 += n;
        });
      }
      place(x, y);
      // Scroll the page when dragging near the top or bottom.
      const edge = 80; if (y < edge + 60) window.scrollBy(0, -10); else if (y > window.innerHeight - edge - 70) window.scrollBy(0, 10);
    }
    function finish(cancel) {
      const d = ui.drag; ui.drag = null; grid()?.classList.remove("is-dragging");
      if (!d) return;
      const gEl = grid(), order = gEl ? [...gEl.children].map(el => el.dataset.id) : [];
      const g = game(), was = g ? gamePoints(g.id).map(p => p.id) : [];
      if (!cancel && order.length && order.join() !== was.join()) saveOrder(order); else render();
    }
    document.addEventListener("pointerdown", e => {
      const tile = e.target.closest && e.target.closest(".etile"); if (!tile || !ui.editLines || e.button > 0) return;
      press = { tile, id: tile.dataset.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== "mouse", moved: false, timer: null };
      if (press.touch) press.timer = setTimeout(() => { if (press && !press.moved) start(); }, HOLD);
    });
    document.addEventListener("pointermove", e => {
      if (!press || e.pointerId !== press.pointerId) return;
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP;
      if (!ui.drag) {
        if (far && press.touch) { clearTimeout(press.timer); press.moved = true; return; }   // it's a scroll
        if (far && !press.touch) start(); else return;
      }
      press.moved = true; moveTo(e.clientX, e.clientY);
    });
    // While dragging with a finger, stop the page from scrolling instead.
    document.addEventListener("touchmove", e => { if (ui.drag) e.preventDefault(); }, { passive: false });
    const up = e => {
      if (!press || (e.pointerId != null && e.pointerId !== press.pointerId)) return;
      clearTimeout(press.timer);
      const p = press; press = null;
      if (ui.drag) { finish(e.type === "pointercancel"); return; }
      if (e.type === "pointerup" && !p.moved && ui.editLines) {   // a tap: select or unselect
        const sel = ui.editLines.sel; sel.has(p.id) ? sel.delete(p.id) : sel.add(p.id); ui.editLines.confirm = false; render();
      }
    };
    document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
    document.addEventListener("contextmenu", e => { if (e.target.closest && e.target.closest(".etile")) e.preventDefault(); });
  })();

  // ---------- actions ----------
  function newPointAfter(srcPt, insertAfter) {
    const g = game(); if (!g) return;
    const pts = gamePoints(g.id);
    const lineup = srcPt ? (srcPt.lineup || []).map(x => ({ ...x })) : [];
    const pt = { id: uid(), game_id: g.id, pos: 0, lineup, plays: srcPt ? playsOf(srcPt) : 2, outcomes: [], note: "" };
    let order = pts.map(x => x.id);
    if (insertAfter) { const i = order.indexOf(srcPt.id); order.splice(i + 1, 0, pt.id); } else order.push(pt.id);
    pt.pos = order.indexOf(pt.id) + 1;
    upsertLocal("points", pt);
    order.forEach((id, i) => { const x = S.points.find(p => p.id === id); if (x) x.pos = i + 1; });
    savePoint(pt).then(() => { if (insertAfter) save("app_reorder_points", { p_game: g.id, p_ids: order }); });
    return pt;
  }
  function movePoint(id, dir) {
    const g = game(), order = gamePoints(g.id).map(x => x.id), i = order.indexOf(id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    save("app_reorder_points", { p_game: g.id, p_ids: order }, () => order.forEach((pid, k) => { const x = S.points.find(p => p.id === pid); if (x) x.pos = k + 1; }));
  }
  // Apply one change (fn) to a line. It shows right away; the save says which version of the line
  // it was based on. If another phone changed the line in the meantime the server says "stale":
  // reload, re-apply this same change to the new version, and save again. Changes to one line are
  // saved one at a time, in order.
  function buildLine(src, fn) {
    const next = JSON.parse(JSON.stringify(src));
    next.outcomes = outs(next); fn(next);
    next.plays = playsOf(next);
    const ids = new Set((next.lineup || []).map(x => x.p));
    next.outcomes = outs(next).map(o => {
      if (o.result !== "us") { o.scorer = null; o.assist = null; }
      if (o.scorer && !ids.has(o.scorer)) o.scorer = null;
      if (o.assist && o.assist !== "none" && !ids.has(o.assist)) o.assist = null;
      return o;
    });
    return next;
  }
  const lineQueue = new Map(), lineWaiting = new Map();
  function patchPoint(id, fn) {
    const pt = S.points.find(x => x.id === id); if (!pt) return;
    upsertLocal("points", buildLine(pt, fn)); render();   // show it now
    lineWaiting.set(id, (lineWaiting.get(id) || 0) + 1);
    const run = async () => {
      pending++;
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          const base = serverLines.get(id) || S.points.find(x => x.id === id);
          if (!base) return;
          const next = buildLine(base, fn);
          try {
            const row = await rpc("app_save_point", { x: { ...next, expect: base.updated_at || null } });
            confirmLine(row); ping(); setSync("live");
            return;
          } catch (e) {
            if (/stale/.test(e.message || "")) {
              const d = await rpc("app_load");   // someone else changed this line: get their version
              const fresh = (d.points || []).find(x => x.id === id);
              if (!fresh) return;
              serverLines.set(id, fresh);
              continue;
            }
            if (e.code === "bad_code") { CODE = ""; store.del("code"); renderGate("The team passcode changed. Enter the new one."); return; }
            setSync("offline"); toast("Couldn't save. Check your connection.", 3500); scheduleRefresh();
            return;
          }
        }
      } finally {
        pending--;
        const left = (lineWaiting.get(id) || 1) - 1; lineWaiting.set(id, left);
        // Nothing else queued for this line: show exactly what the server has.
        if (!left && serverLines.has(id)) { upsertLocal("points", JSON.parse(JSON.stringify(serverLines.get(id)))); render(); }
      }
    };
    const p = (lineQueue.get(id) || Promise.resolve()).then(run, run);
    lineQueue.set(id, p);
    return p;
  }
  // The point after point k of a line: the next slot in the same line, or the first point of the next line.
  function nextPointAfter(lineId, k) {
    const ln = S.points.find(x => x.id === lineId); if (!ln) return null;
    if (k + 1 < playsOf(ln)) return { lineId, k: k + 1 };
    const lines = gamePoints(ln.game_id), i = lines.findIndex(x => x.id === lineId);
    return lines[i + 1] ? { lineId: lines[i + 1].id, k: 0 } : null;
  }
  function patchGame(fn) { const g = game(); if (!g) return; const next = JSON.parse(JSON.stringify(g)); fn(next); saveGame(next); }

  async function createGame(name, date, copyFrom, tournamentId) {
    const g = { id: uid(), name, opponent: "", game_date: date || null, tournament_id: tournamentId || null, zone: copyFrom ? JSON.parse(JSON.stringify(copyFrom.zone || {})) : { deep: [], cup: [], short: [] } };
    ui.gameId = g.id; store.set("game", g.id);
    const ok = await saveGame(g);
    if (ok && copyFrom) {
      for (const [i, pt] of gamePoints(copyFrom.id).entries()) {
        await savePoint({ id: uid(), game_id: g.id, pos: i + 1, lineup: (pt.lineup || []).map(x => ({ ...x })), plays: playsOf(pt), outcomes: [], note: "" });
      }
    }
    render();
  }

  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const a = el.dataset.act, id = el.dataset.id;
    if (a === "scrim") { if (e.target === el) closeSheet(); return; }
    if (a === "close") { closeSheet(); return; }
    if (a === "tab") { ui.tab = el.dataset.tab; store.set("tab", ui.tab); render(); window.scrollTo(0, 0); return; }
    if (a === "game-menu") { openSheet({ type: "game-menu" }); return; }
    if (a === "new-game") { openSheet({ type: "game-form", tour: "" }); return; }
    if (a === "new-game-tour") { openSheet({ type: "game-form", tour: game()?.tournament_id || "" }); return; }
    if (a === "new-tour") { openSheet({ type: "tour-form" }); return; }
    if (a === "edit-tour") { openSheet({ type: "tour-form", id: game()?.tournament_id }); return; }
    if (a === "delete-tour") {
      if (!el.dataset.v) { ui.sheet.confirm = "tour"; renderSheet(); return; }
      const tid = game()?.tournament_id; closeSheet(); removeTour(tid, el.dataset.v === "all"); return;
    }
    if (a === "edit-game") { openSheet({ type: "game-form", id: ui.gameId }); return; }
    if (a === "copy-game") { openSheet({ type: "game-form", copyFrom: ui.gameId }); return; }
    if (a === "delete-game") {
      if (ui.sheet.confirm !== "game") { ui.sheet.confirm = "game"; renderSheet(); return; }
      const gid = ui.gameId; closeSheet();
      save("app_delete_game", { p_id: gid }, () => { removeLocal("games", gid); S.points = S.points.filter(x => x.game_id !== gid); ui.gameId = S.games.length ? S.games[S.games.length - 1].id : null; store.set("game", ui.gameId); });
      return;
    }
    if (a === "add-point") { const pts = gamePoints(ui.gameId); newPointAfter(null, false); if (swipeMode()) showLine(pts.length, false); setTimeout(() => { const cards = document.querySelectorAll(".point"); cards[cards.length - 1]?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 50); void pts; return; }
    if (a === "role") { const k = +el.dataset.k; patchPoint(id, pt => { const s = pt.lineup[k]; if (s) { const cur = s.r === "P" ? "C" : (s.r || ""); s.r = ROLES[(ROLES.indexOf(cur) + 1) % ROLES.length]; } }); return; }
    if (a === "od") { const k = +el.dataset.k; patchPoint(id, pt => { const o = pt.outcomes[k]; o.start_on = o.start_on === el.dataset.v ? "" : el.dataset.v; }); return; }
    if (a === "go-line") { const cur = (ui.swipe && ui.swipe.i) || 0; showLine(el.dataset.dir ? cur + +el.dataset.dir : +el.dataset.i, true); return; }
    if (a === "jump-now") { jumpNow(); return; }
    if (a === "result") {
      const done = watchFinish(id);
      const k = +el.dataset.k, cur = outs(S.points.find(x => x.id === id))[k], res = cur.result === el.dataset.v ? "" : el.dataset.v;
      // Whoever gets scored on receives: they scored -> we start next point on O; we scored -> D.
      const nextStart = res === "them" ? "O" : res === "us" ? "D" : "";
      const nxt = nextPointAfter(id, k);
      patchPoint(id, pt => {
        pt.outcomes[k].result = res;
        if (nextStart && nxt && nxt.lineId === id && !pt.outcomes[nxt.k].result) pt.outcomes[nxt.k].start_on = nextStart;
      });
      if (nextStart && nxt && nxt.lineId !== id) {
        const no = outs(S.points.find(x => x.id === nxt.lineId))[nxt.k];
        if (!no.result) patchPoint(nxt.lineId, pt => { pt.outcomes[nxt.k].start_on = nextStart; });
      }
      done();
      return;
    }
    if (a === "set-goal") { const k = +el.dataset.k, v = el.dataset.p; patchPoint(id, pt => { const o = pt.outcomes[k]; o.scorer = v; if (o.assist === v) o.assist = null; }); return; }
    if (a === "set-assist") { const done = watchFinish(id), k = +el.dataset.k, v = el.dataset.p; patchPoint(id, pt => { pt.outcomes[k].assist = v; }); done(); return; }
    if (a === "ga-change") { const k = +el.dataset.k; patchPoint(id, pt => { pt.outcomes[k].scorer = null; pt.outcomes[k].assist = null; }); return; }
    if (a === "pick-slot") { const pt = S.points.find(x => x.id === id), k = +el.dataset.k; openSheet({ type: "pick", pointId: id, k, current: pt?.lineup?.[k]?.p || null }); return; }
    if (a === "pick-f") { ui.sheet.f = el.dataset.v; renderSheet(); return; }
    if (a === "edit-lines") { closeSheet(); ui.editLines = { sel: new Set(), confirm: false }; ui.undoDel = null; render(); window.scrollTo(0, 0); return; }
    if (a === "edit-done") { ui.editLines = null; render(); setTimeout(checkVersion, 300); return; }
    if (a === "edit-delete") { if (!ui.editLines.confirm) { ui.editLines.confirm = true; render(); return; } deleteSelected(); return; }
    if (a === "undo-delete") { undoDelete(); return; }
    if (a === "undo-delete-done") { ui.undoDel = null; render(); return; }
    if (a === "fill-open") { openSheet({ type: "fill", n: 3, plays: 2, existing: true }); return; }
    if (a === "fill-n") { ui.sheet.n = +el.dataset.v; renderSheet(); return; }
    if (a === "fill-pairing") { ui.pairing = el.dataset.v; store.set("pairing", ui.pairing); renderSheet(); return; }
    if (a === "fill-plays") { ui.sheet.plays = +el.dataset.v; renderSheet(); return; }
    if (a === "fill-go") { const s = ui.sheet, ex = $("#fillExisting")?.checked; ui.sheet = null; renderSheet(); autoFill({ newLines: s.n, plays: s.plays, existing: ex }); return; }
    if (a === "ratio-five" || a === "ratio-keep") { const s = ui.sheet; ui.sheet = null; renderSheet(); s.resolve(a === "ratio-five" ? "five" : "keep"); return; }
    if (a === "fill-late") { ui.lateMode = el.dataset.v; store.set("lateMode", ui.lateMode); renderSheet(); return; }
    if (a === "tour-del") {
      if (!el.dataset.v) { ui.sheet.confirm = true; renderSheet(); return; }
      const tid = ui.sheet.id; closeSheet(); removeTour(tid, el.dataset.v === "all"); return;
    }
    if (a === "home-tour") { openTour(id); return; }
    if (a === "home-game") { openGame(id); return; }
    if (a === "home-late") { openSheet({ type: "late", tid: id }); return; }
    if (a === "home-edit-tour") { openSheet({ type: "tour-form", id }); return; }
    if (a === "home-new-tour") { openSheet({ type: "tour-form", home: true }); return; }
    if (a === "home-practice") { ui.tab = "practice"; store.set("tab", "practice"); newPractice(todayISO()); window.scrollTo(0, 0); return; }
    if (a === "late-open") { const t = tourOf(game()); if (t) openSheet({ type: "late", tid: t.id }); return; }
    if (a === "late-mark") { markLate(ui.sheet.tid, el.dataset.p); return; }
    if (a === "pr-new") { newPractice(todayISO()); return; }
    if (a === "pr-new-date") { openSheet({ type: "pr-date" }); return; }
    if (a === "pr-open") { ui.practiceId = id; ui.prConfirm = null; ui.prMode = "here"; render(); window.scrollTo(0, 0); return; }
    if (a === "pr-close") { ui.practiceId = null; ui.prConfirm = null; ui.prMode = "here"; render(); return; }
    if (a === "pr-mode") { ui.prMode = el.dataset.v; render(); return; }
    if (a === "pr-mark") { if (ui.prMode === "sit") markSitting(ui.practiceId, el.dataset.p); else markPractice(ui.practiceId, el.dataset.p); return; }
    if (a === "pr-delete") {
      const pid = ui.practiceId; if (!pid) return;
      if (ui.prConfirm !== pid) { ui.prConfirm = pid; render(); return; }
      ui.prConfirm = null; ui.practiceId = null; ui.scrim = null;
      save("app_delete_practice", { p_id: pid }, () => { S.practices = (S.practices || []).filter(x => x.id !== pid); });
      toast("Practice deleted"); return;
    }
    if (a === "scrim-make") { const pr = (S.practices || []).find(x => x.id === ui.practiceId); if (pr) { ui.scrim = { pid: pr.id, ...scrimSplit(scrimmers(pr)) }; render(); } return; }
    if (a === "scrim-clear") { ui.scrim = null; render(); return; }
    if (a === "auto-undo") { undoAuto(); return; }
    if (a === "auto-done") { ui.auto = null; render(); return; }
    if (a === "o-rookie") { const r = new Set(ui.owner.rookies); r.has(id) ? r.delete(id) : r.add(id); ui.owner.rookies = [...r]; saveOwner(); return; }
    if (a === "o-add") {
      const k = el.dataset.k, x = $("#" + k + "P").value;
      if (!x) { toast("Pick a person first"); return; }
      if (ui.owner[k].some(g => g.p === x)) { toast(label(P(x)) + " already has a list. Add people to it."); return; }
      ui.owner[k] = [...ui.owner[k], { p: x, with: [] }]; saveOwner(); return;
    }
    if (a === "o-del") { const k = el.dataset.k, i = +el.dataset.i; ui.owner[k] = ui.owner[k].filter((_, j) => j !== i); saveOwner(); return; }
    if (a === "o-unwith") { const k = el.dataset.k, i = +el.dataset.i, g = ui.owner[k][i]; g.with = g.with.filter(x => x !== el.dataset.p); saveOwner(); return; }
    if (a === "o-lock") { OWNER = ""; store.del("owner"); ui.owner = null; render(); toast("Locked"); return; }
    if (a === "pick-sort") { ui.pickSort = el.dataset.v; store.set("pickSort", ui.pickSort); renderSheet(); return; }
    if (a === "pick") {
      const pid = el.dataset.p, s = ui.sheet;
      if (s.zone) { const z = s.zone; saveZone(n => { n[z] = [...n[z], pid]; }); renderSheet(); return; }
      patchPoint(s.pointId, pt => {
        pt.lineup = pt.lineup || [];
        if (pt.lineup.some(x => x.p === pid)) return;   // already on (maybe added from another phone)
        if (s.current) { const slot = pt.lineup.find(x => x.p === s.current); if (slot) slot.p = pid; }
        else if (pt.lineup.length < SLOTS) pt.lineup.push({ p: pid, r: "" });
      });
      closeSheet(); return;
    }
    if (a === "pick-remove") { const s = ui.sheet; patchPoint(s.pointId, pt => { pt.lineup = pt.lineup.filter(x => x.p !== s.current); }); closeSheet(); return; }
    if (a === "point-menu") { openSheet({ type: "point-menu", id }); return; }
    if (a === "paste-line") {
      const pt = S.points.find(x => x.id === id); if (!pt || !ui.clip) return;
      ui.undo = { id, lineup: JSON.parse(JSON.stringify(pt.lineup || [])) };
      patchPoint(id, x => { x.lineup = ui.clip.lineup.map(y => ({ ...y })).slice(0, SLOTS); });
      toast("Pasted"); return;
    }
    if (a === "paste-new") { if (ui.clip) { newPointAfter({ lineup: ui.clip.lineup, plays: 2 }, false); ui.undo = null; toast("Added a pasted line"); } return; }
    if (a === "undo-paste") { const u = ui.undo; if (u) { ui.undo = null; patchPoint(u.id, x => { x.lineup = u.lineup; }); toast("Paste undone"); } return; }
    if (a === "clip-done") { ui.clip = null; ui.undo = null; store.del("clip"); render(); return; }
    if (a.startsWith("pm-")) {
      const pid = ui.sheet.id, pt = S.points.find(x => x.id === pid);
      if (a === "pm-delete") {
        if (!ui.sheet.confirm) { ui.sheet.confirm = true; renderSheet(); return; }
        closeSheet();
        const g = game();
        save("app_delete_point", { p_id: pid }, () => removeLocal("points", pid)).then(() => {
          const order = gamePoints(g.id).map(x => x.id);
          save("app_reorder_points", { p_game: g.id, p_ids: order }, () => order.forEach((x, i) => { S.points.find(p => p.id === x).pos = i + 1; }));
        });
        return;
      }
      closeSheet();
      if (a === "pm-suggest") autoFill({ only: pid });
      if (a === "pm-copy") {
        const lines = gamePoints(ui.gameId), n = lines.findIndex(x => x.id === pid) + 1, g = game();
        ui.clip = { lineup: (pt.lineup || []).map(y => ({ p: y.p, r: y.r || "" })), from: "Line " + n + (g ? " · " + g.name : "") };
        ui.undo = null; store.set("clip", ui.clip); render(); toast("Copied. Tap Paste on any line.");
      }
      if (a === "pm-dup") newPointAfter(pt, false);
      if (a === "pm-insert") newPointAfter(pt, true);
      if (a === "pm-up") movePoint(pid, -1);
      if (a === "pm-down") movePoint(pid, 1);
      if (a === "pm-clear") patchPoint(pid, x => { x.lineup = []; });
      if (a === "pm-clear-result") patchPoint(pid, x => { x.outcomes = []; });
      if (a === "pm-plays") { const v = +el.dataset.v; patchPoint(pid, x => { x.plays = v; x.outcomes = x.outcomes.slice(0, v); }); }
      return;
    }
    if (a === "bucket") { ui.openBucket = ui.openBucket === el.dataset.k ? null : el.dataset.k; render(); return; }
    if (a === "zone-add") { openSheet({ type: "pick", zone: el.dataset.z }); return; }
    if (a === "zone-remove") { const z = el.dataset.z, i = +el.dataset.i; saveZone(n => { n[z].splice(i, 1); }); return; }
    if (a === "stats-scope") { ui.stats.scope = el.dataset.v; render(); return; }
    if (a === "sort") { ui.stats.sort = el.dataset.k; render(); return; }
    if (a === "add-g") { ui.addG = el.dataset.v; render(); return; }
    if (a === "p-gender") { const p = P(id); savePlayer({ ...p, gender: p.gender === "W" ? "M" : "W" }); return; }
    if (a === "p-badge") { const p = P(id); savePlayer({ ...p, badge: BADGES[(BADGES.indexOf(p.badge || "") + 1) % BADGES.length] }); return; }
    if (a === "p-active") { const p = P(id); savePlayer({ ...p, active: !p.active }); return; }
    if (a === "p-delete") {
      if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Sure?"; el.style.width = "auto"; el.style.color = "var(--red)"; setTimeout(() => { if (el.isConnected) { el.dataset.confirm = ""; el.textContent = "×"; el.style.color = ""; } }, 3000); return; }
      save("app_delete_player", { p_id: id }, () => removeLocal("players", id)); return;
    }
    if (a === "copy-link") {
      const text = $("#shareLink").textContent;
      try { navigator.clipboard.writeText(text).then(() => toast("Link copied"), () => toast("Select the link and copy it")); } catch (err) { toast("Select the link and copy it"); }
      return;
    }
    if (a === "logout") { store.del("code"); store.del("cache"); store.del("owner"); CODE = ""; location.reload(); return; }
  });

  document.addEventListener("change", e => {
    const el = e.target;
    if (el.id === "gameSel") { ui.swipe = null; ui.editLines = null; ui.undoDel = null; ui.gameId = el.value; store.set("game", ui.gameId); render(); return; }
    const a = el.dataset.act, id = el.dataset.id;
    if (el.id === "fillAtt") { ui.useAtt = el.checked; store.set("useAtt", ui.useAtt); return; }
    if (el.id === "prDate") {
      const pr = (S.practices || []).find(x => x.id === ui.practiceId), v = el.value;
      if (!pr || !v || v === pr.practice_date) { if (pr) el.value = pr.practice_date; return; }
      save("app_save_practice", { x: { ...pr, practice_date: v } }, () => { pr.practice_date = v; });
      return;
    }
    if (a === "p-name") { const p = P(id), v = el.value.trim(); if (v && v !== p.name) savePlayer({ ...p, name: v }); else el.value = p.name; return; }
    if (a === "o-with") { const g = ui.owner[el.dataset.k][+el.dataset.i]; if (el.value && !g.with.includes(el.value)) { g.with.push(el.value); saveOwner(); } return; }
    if (a === "p-nick") { const p = P(id), v = el.value.trim(); if (v !== p.nick) savePlayer({ ...p, nick: v }); return; }
  });

  document.addEventListener("input", e => {
    if (e.target.id === "pickQ") { ui.sheet.q = e.target.value; const pos = e.target.selectionStart; renderSheet(); const q = $("#pickQ"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) {} }
    if (e.target.id === "rosterFilter") { ui.rosterFilter = e.target.value; render(); }
    // Keep a half-typed new player across redraws (tapping W/M, or a change from another phone).
    if (e.target.id === "addName") ui.addName = e.target.value;
    if (e.target.id === "addNick") ui.addNick = e.target.value;
  });

  // iPhones ignore the "no zoom" setting for pinches, so stop the pinch gesture itself.
  ["gesturestart", "gesturechange"].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && ui.sheet) closeSheet();
    if (e.key === "Enter" && e.target.id === "rosterFilter") { e.preventDefault(); tryOwner(e.target.value.trim()); }
  });

  document.addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "addForm") {
      const name = $("#addName").value.trim().replace(/\s+/g, " "); if (!name) return;
      if (S.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast(name + " is already on the roster"); return; }
      const nick = $("#addNick").value.trim() || name.split(" ")[0];
      ui.addName = ""; ui.addNick = "";
      savePlayer({ id: uid(), name, nick, gender: ui.addG === "W" ? "W" : "M", active: true, created_at: new Date().toISOString() });
      toast("Added " + name); setTimeout(() => $("#addName")?.focus(), 0);
      return;
    }
    if (f.id === "gameForm") {
      const name = $("#gName").value.trim(), date = $("#gDate").value, tid = $("#gTour").value || null; if (!name) return;
      const s = ui.sheet; closeSheet();
      if (s.id) { const g = S.games.find(x => x.id === s.id); saveGame({ ...g, name, game_date: date || null, tournament_id: tid }); }
      else createGame(name, date, s.copyFrom ? S.games.find(x => x.id === s.copyFrom) : null, tid);
      return;
    }
    if (f.id === "tourForm") {
      const name = $("#tName").value.trim(), date = $("#tDate").value, location = ($("#tWhere")?.value || "").trim(); if (!name) return;
      const s = ui.sheet;
      if (s.id) { const t = tours().find(x => x.id === s.id); closeSheet(); save("app_save_tournament", { x: { ...t, name, start_date: date || null, location } }, () => Object.assign(t, { name, start_date: date || null, location })); }
      else {
        const t = { id: uid(), name, start_date: date || null, location, late: [] };
        save("app_save_tournament", { x: t }, () => { S.tournaments = [...tours(), t]; });
        if (s.home) closeSheet(); else openSheet({ type: "game-form", tour: t.id });
      }
      return;
    }
    if (f.id === "prDateForm") {
      const v = $("#prNewDate").value; if (!v) return;
      closeSheet(); ui.tab = "practice"; newPractice(v); return;
    }
    if (f.id === "codeForm") {
      const v = $("#newCode").value.trim(); if (v.length < 4) { toast("Use at least 4 characters"); return; }
      rpc("app_set_code", { p_new: v }).then(() => { CODE = v; store.set("code", v); $("#newCode").value = ""; toast("Passcode changed. Tell the team."); }, () => toast("Couldn't change it. Try again."));
      return;
    }
    if (f.id === "gateForm") {
      const v = $("#gateCode").value.trim(); if (!v) return;
      CODE = v; store.set("code", v);
      $("#gateBtn").disabled = true; $("#gateBtn").textContent = "Opening…";
      load(true);
    }
  });

  // GitHub Pages lets browsers cache files for ~10 minutes. Check version.json (never cached)
  // and reload onto the new build when one is published, so nobody edits with an old copy.
  async function checkVersion() {
    try {
      const r = await fetch("version.json?" + Date.now(), { cache: "no-store" });
      const { v } = await r.json();
      // Don't reload under someone mid-edit (typing, a sheet open, dragging lines); try again later.
      const busy = ui.sheet || ui.drag || ui.editLines || (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName));
      if (v && v !== APP_VERSION && pending === 0 && !busy) {
        const u = new URL(location.href); u.searchParams.set("v", v); location.replace(u.toString());
      }
    } catch (e) {}
  }
  checkVersion();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
  setInterval(() => { if (!document.hidden) checkVersion(); }, 5 * 60000);

  window.addEventListener("focus", () => { if (S.team) scheduleRefresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.team) scheduleRefresh(); });
  setInterval(() => { if (S.team && !document.hidden) scheduleRefresh(); }, 60000);

  // Say so once when this phone has just moved onto a new version.
  (function announceVersion() {
    const seen = store.get("seenVersion", null);
    if (seen && seen !== APP_VERSION) setTimeout(() => toast("Updated to v" + APP_VERSION.replace(/^(test\.|\d{4}\.)/, "")), 900);
    store.set("seenVersion", APP_VERSION);
  })();

  // ---------- gate ----------
  function renderGate(msg) {
    ui.sheet = null; renderSheet();
    if (!TOKEN) {
      $("#app").innerHTML = `<div class="gate"><div class="gate-card"><h1>Deep Blue</h1><p>This board needs the team link. Ask a captain to send it to you.</p></div></div>`;
      return;
    }
    $("#app").innerHTML = `<div class="gate"><form class="gate-card" id="gateForm">
      <h1>Deep Blue</h1>
      <p>Lines, zone spots and stats for the team. Enter the team passcode.</p>
      <input class="line-in" id="gateCode" type="password" placeholder="Passcode" autocomplete="current-password" autofocus>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <button class="btn primary" id="gateBtn" type="submit">Open the board</button>
    </form></div>`;
  }

  // ---------- boot ----------
  if (!TOKEN) renderGate();
  else if (!CODE) renderGate();
  else {
    const cached = store.get("cache", null);
    if (cached) { S = cached; if (!game() && S.games.length) ui.gameId = S.games[S.games.length - 1].id; render(); }
    load(true);
  }
})();
