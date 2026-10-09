/* Deep Blue Board, TEST copy: line maker + private settings, on a separate test team.
   Deep Blue Board: shared point planner + stats.
   Data lives in Supabase. The browser never touches tables directly; every read and
   write goes through app_* functions that check the team link token and passcode. */
(function () {
  "use strict";

  const SUPABASE_URL = "https://hqlvhzrafntwqsktxljl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_RxdiFg2zzl4aYnH92hQ6-g_ZACvuXLc";
  const APP_VERSION = "test.22"; // keep in sync with test/version.json and the ?v= in test/index.html
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
  const ui = { tab: ((t => t === "zone" ? "roster" : t)(store.get("tab", "home"))), tourId: store.get("tourId", null), gameId: store.get("game", null), stats: { scope: "game", sort: "pts" }, sheet: null, sync: "connecting", rosterFilter: "" };
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
  const TABS = [["home", "Home"], ["points", "Points"], ["practice", "Practice"], ["stats", "Stats"], ["roster", "Roster"]];
  const LOGO = `<svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><path d="M3 6.5 C 6 2.5, 10 2.5, 13 6.5 S 20 10.5, 23 6.5 S 27 3.5, 28 4.5" fill="none" stroke="#0b2540" stroke-width="2.4" stroke-linecap="round"/><path d="M3 13.5 C 6 9.5, 10 9.5, 13 13.5 S 20 17.5, 23 13.5" fill="none" stroke="#1f6fd1" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  // The waterline: everything after it sits in the deep (what's coming next).
  const deep = html => `<div class="wave" aria-hidden="true"></div><section class="deep"><div class="deep-in">${html}</div></section>`;
  // Laptops show every line at once; phones show one line card with the rest below the wave.
  const wide = () => matchMedia("(min-width:760px)").matches;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function render() {
    if (!S.team) return;
    if (ui.drag) { ui.drag.pending = true; return; }   // never redraw under a finger mid-drag
    const app = $("#app");
    const active = document.activeElement;
    const keep = active && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const tabNow = ui.tab === "tour" ? "home" : ui.tab;
    const tabsHTML = TABS.map(([k, t]) => `<button data-act="tab" data-tab="${k}" ${tabNow === k ? 'aria-current="page"' : ""}>${t}</button>`).join("");
    const opt = (g, withDate) => `<option value="${g.id}" ${g.id === ui.gameId ? "selected" : ""}>${esc(g.name)}${withDate && g.game_date ? " · " + fmtDate(g.game_date) : ""}</option>`;
    const loose = S.games.filter(g => !tourOf(g));
    const gameOpts = tours().map(t => { const gs = S.games.filter(g => g.tournament_id === t.id); return gs.length ? `<optgroup label="${esc(t.name)}">${gs.map(g => opt(g, false)).join("")}</optgroup>` : ""; }).join("")
      + (loose.length ? (tours().length ? `<optgroup label="Other games">${loose.map(g => opt(g, true)).join("")}</optgroup>` : loose.map(g => opt(g, true)).join("")) : "");
    ui.wasWide = wide();
    app.innerHTML = `
      <header class="top"><div class="top-in">
        <button class="brand" data-act="tab" data-tab="home" aria-label="Deep Blue, go to Home">${LOGO}<span>Deep Blue</span> <span class="test-tag">TEST</span></button>
        <div class="game-pick"${ui.tab === "points" || ui.tab === "stats" ? "" : " hidden"}>
          ${S.games.length ? `<select id="gameSel" aria-label="Game">${gameOpts}</select>` : ""}
          <button class="icon-btn" data-act="game-menu" aria-label="Game options">⋯</button>
        </div>
        <nav class="tabs" aria-label="Sections">${tabsHTML}</nav>
        <span class="sync ${ui.sync}" id="sync"><i></i><span>${ui.sync === "live" ? "Live" : ui.sync === "offline" ? "Offline" : "Connecting"}</span></span>
        <span class="ver" title="Board version">v${esc(APP_VERSION.replace(/^(test\.|\d{4}\.)/, ""))}</span>
      </div></header>
      <main id="main" class="tab-${ui.tab}">${ui.tab === "stats" ? renderStats() : ui.tab === "roster" ? renderRoster() : ui.tab === "practice" ? renderPractice() : ui.tab === "home" ? renderHome() : ui.tab === "tour" ? renderTour() : renderPoints()}</main>
      ${ui.tab !== "points" ? "" : ui.editLines ? editBar() : ui.undoDel ? undoDelBar() : ui.auto ? autoBar() : ui.clip ? clipBar() : ""}
      <nav class="bottom-nav" aria-label="Sections">${tabsHTML}</nav>`;
    renderSheet();
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch (e) {} } }
    if (ui.tab === "points") afterPoints();
  }
  // Crossing the phone / laptop width changes the Points layout, so redraw then.
  window.addEventListener("resize", () => { clearTimeout(render.rt); render.rt = setTimeout(() => { if (S.team && ui.wasWide !== wide()) render(); }, 150); });

  // ---------- which line a phone is looking at ----------
  // ui.swipe = { game, i }: the line card a phone shows, kept across redraws (every save redraws).
  // A game opens on the NOW line; once a line is finished (scores, scorers and assists in) it
  // moves on to the next line by itself.
  function trackOf() { return document.getElementById("pointsTrack"); }
  function focusIndex(lines) {
    if (!ui.swipe || ui.swipe.game !== ui.gameId || !Number.isFinite(ui.swipe.i)) { const now = nowPoint(lines); ui.swipe = { game: ui.gameId, i: now ? now.line : Math.max(lines.length - 1, 0) }; }
    ui.swipe.i = Math.max(0, Math.min(ui.swipe.i, lines.length));
    return ui.swipe.i;
  }
  function showLine(i) {
    const g = game(); if (!g) return;
    const n = gamePoints(g.id).length;
    ui.swipe = { game: ui.gameId, i: Math.max(0, Math.min(Number.isFinite(+i) ? +i : 0, n)) };
    ui.openPt = null;
    render();
    if (!wide()) { const c = document.querySelector("#pointsTrack .point, #pointsTrack .add-card"); if (c) c.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
  function afterPoints() {
    if (ui.advanceTo != null) { const to = ui.advanceTo; ui.advanceTo = null; setTimeout(() => { if (ui.tab === "points") { showLine(to); window.scrollTo({ top: 0, behavior: "smooth" }); } }, 700); }
    if (wide() && ui.scrollToLine != null) { const i = ui.scrollToLine; ui.scrollToLine = null; setTimeout(() => document.querySelectorAll("#pointsTrack .point")[i]?.scrollIntoView({ block: "start", behavior: "smooth" }), 60); }
  }
  function jumpNow() {
    const g = game(), now = g ? nowPoint(gamePoints(g.id)) : null; if (!now) return;
    if (wide()) { ui.scrollToLine = now.line; render(); } else { showLine(now.line); window.scrollTo({ top: 0, behavior: "smooth" }); }
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
    return `<div class="above"><h1 class="page-title">No game yet</h1><p class="page-sub">Make a game to start planning lines.</p><div class="row"><button class="btn primary" data-act="new-game">New game</button><button class="btn" data-act="tab" data-tab="home">Tournaments</button></div></div>`;
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
  const swipeMode = () => !wide();
  // First point number of each line.
  const lineStarts = lines => { let n = 1; return lines.map(pt => { const f = n; n += playsOf(pt); return f; }); };

  function renderPoints() {
    const g = game(); if (!g) return noGame();
    if (ui.editLines) return renderEditLines(g);
    const lines = gamePoints(g.id), st = computeStats(lines).team, now = nowPoint(lines), starts = lineStarts(lines), t = tourOf(g);
    const head = `<div class="game-head">
        <div class="gh-l">${t ? `<button class="back-link" data-act="home-tour" data-id="${t.id}">‹ ${esc(t.name)}</button>` : ""}<button class="gh-name gh-pick" data-act="games" aria-label="${esc(g.name)}, switch game">${esc(g.name)} <span aria-hidden="true">▾</span></button></div>
        <div class="score"><b>${st.us}–${st.them}</b><small>${plural(st.holds, "hold")} · ${plural(st.breaks, "break")}</small></div>
      </div>`;
    const card = i => lineCard(lines[i], i, starts[i], restFor(g, lines, i), now && now.line === i ? now.k : -1, { lines, now });
    if (wide()) return renderPointsWide(g, lines, head, card, now);
    const i = focusIndex(lines);
    const addCard = `<div class="add-card"><p>${lines.length ? "Add another line to this game." : "No lines yet. Add one, or let the line maker fill a few."}</p>
        <div class="two-btns"><button class="btn primary" data-act="add-point">+ Add line</button>${ui.clip ? '<button class="btn" data-act="paste-new">+ Paste as new line</button>' : '<button class="btn" data-act="fill-open">Fill lines</button>'}</div></div>`;
    // Below the waterline: the lines after this one (up next first), then the ones before.
    const names = (pt, small) => `<span class="names">${(pt.lineup || []).map(s => { const p = P(s.p); return `<span><i class="dot ${p?.gender || ""}"></i>${esc(label(p))}${p?.badge ? " " + p.badge : ""}</span>`; }).join("") || "<span>No players yet</span>"}</span>`;
    const dots = pt => `<span class="rdots">${outs(pt).map(o => `<i class="rdot ${o.result === "us" ? "us" : o.result === "them" ? "them" : ""}"></i>`).join("")}</span>`;
    const row = (j, big) => { const pt = lines[j], n = playsOf(pt), f = starts[j], next = outs(pt)[0];
      const what = now && now.line === j ? `NOW · Pt ${now.n}` : `${n === 1 ? "Pt " + f : "Pts " + f + "–" + (f + n - 1)}${big && next.start_on ? ` · starts on ${next.start_on}` : ""}`;
      return `<button class="up-row${big ? "" : " small"}" data-act="go-line" data-i="${j}"><span class="ur-h"><b>Line ${j + 1}</b><span>${what}</span>${outs(pt).some(o => o.result) ? dots(pt) : ""}</span>${names(pt, !big)}</button>`; };
    const after = lines.map((_, j) => j).filter(j => j > i), before = lines.map((_, j) => j).filter(j => j < i);
    const below = `${after.length ? `<span class="eyebrow">Up next ↓</span><div>${after.map((j, k) => row(j, k === 0)).join("")}</div>` : ""}
      <div class="deep-actions">${i < lines.length ? '<button class="add-dashed" data-act="add-point">+ Add line</button>' : ""}${ui.clip && i < lines.length ? '<button class="add-dashed" data-act="paste-new">+ Paste as new line</button>' : ""}</div>
      ${before.length ? `<span class="eyebrow" style="margin-top:8px">Earlier lines</span><div>${before.slice().reverse().map(j => row(j, false)).join("")}</div>` : ""}
      ${pointsChart(lines)}`;
    return `<div class="above">${head}<div id="pointsTrack">${i < lines.length ? card(i) : addCard}</div></div>${deep(below)}`;
  }

  // Laptops: the played, NOW and next lines above the water beside points per person; the
  // lines planned further ahead below it.
  function renderPointsWide(g, lines, head, card, now) {
    const t = tourOf(g), st = computeStats(lines).team, starts = lineStarts(lines);
    const cardC = (i, dark) => lineCard(lines[i], i, starts[i], restFor(g, lines, i), now && now.line === i ? now.k : -1, { lines, now, compact: true, dark });
    const cut = now ? now.line + 2 : lines.length, top = lines.map((_, i) => i).filter(i => i < cut), rest = lines.map((_, i) => i).filter(i => i >= cut);
    const whead = `<div class="game-head wide">
        <div class="gh-l">${t ? `<button class="back-link" data-act="home-tour" data-id="${t.id}">‹ ${esc(t.name)}${t.start_date ? " · " + fmtDay(t.start_date) : ""}</button>` : ""}<h1 class="gh-name">${esc(g.name)}</h1></div>
        <div class="score inline"><b>${st.us}–${st.them}</b><small>${plural(st.holds, "hold")} · ${plural(st.breaks, "break")}${now ? ` · <button class="link-btn" data-act="jump-now">Pt ${now.n} is on</button>` : ""}</small></div>
        <span class="grow"></span>
        <div class="row"><button class="btn primary" data-act="fill-open">Fill lines</button>${lines.length ? '<button class="btn" data-act="edit-lines">Edit lines</button>' : ""}<button class="btn dashed" data-act="add-point">+ Add line</button>${ui.clip ? '<button class="btn" data-act="paste-new">+ Paste as new line</button>' : ""}</div>
      </div>`;
    const range = rest.length ? (rest.length === 1 ? `LINE ${rest[0] + 1}` : `LINES ${rest[0] + 1}–${rest[rest.length - 1] + 1}`) : "";
    return `<div class="above">${whead}
        <div class="wide-grid"><div id="pointsTrack" class="lines-grid">${top.map(i => cardC(i)).join("") || '<div class="add-card"><p>No lines yet. Add one, or let Fill lines plan a few.</p></div>'}</div>
        <aside class="side card">${pointsChart(lines, true) || '<p class="muted" style="margin:0">Points per person shows up once there are lines.</p>'}</aside></div>
      </div>${rest.length ? deep(`<div class="deep-title"><span class="eyebrow">Planned ↓ ${range}</span><span class="muted">Click a name to swap.</span></div><div class="lines-grid">${rest.map(i => cardC(i, true)).join("")}</div>`) : ""}`;
  }

  function clipBar() {
    const names = ui.clip.lineup.map(x => label(P(x.p))).join(", ");
    return `<div class="clipbar" role="status">
      <span class="clip-text"><b>Copied ${esc(ui.clip.from)}</b>${esc(names) || "(no players)"}</span>
      ${ui.undo ? '<button class="btn" data-act="undo-paste">Undo</button>' : ""}
      <button class="btn" data-act="clip-done">Done</button>
    </div>`;
  }

  // One line as a card: its players as tiles, then its points. The point we're on gets the big
  // O/D and result buttons; a goal waiting for its scorer or thrower asks right in the card.
  function lineCard(pt, i, from, rest, nowK, ctx) {
    const line = pt.lineup || [], o = outs(pt), n = o.length, to = from + n - 1, lines = ctx.lines, compact = !!ctx.compact;
    let w = 0, m = 0; line.forEach(s => { const p = P(s.p); if (p?.gender === "W") w++; else if (p?.gender === "M") m++; });
    const caps = line.filter(s => isLead(P(s.p))).length;
    const zs = zoneSets(), spots = DBLines.assignSpots(line.map(s => s.p), zs);
    const listed = k => zs[k].main.size + zs[k].ok.size > 0;
    const missing = line.length ? [listed("deep") && !spots.deep ? "no DD" : "", listed("short") && !spots.short ? "no SD" : ""].filter(Boolean) : [];
    const goals = new Map(), assists = new Map();
    o.forEach(x => { if (x.result === "us") { if (x.scorer) goals.set(x.scorer, (goals.get(x.scorer) || 0) + 1); if (x.assist && x.assist !== "none") assists.set(x.assist, (assists.get(x.assist) || 0) + 1); } });
    const pending = o.findIndex(x => x.result === "us" && !(x.scorer && x.assist));   // a goal still being recorded
    const played = o.every(x => x.result), started = o.some(x => x.result);
    const nowLine = ctx.now ? ctx.now.line : lines.length;
    const pill = pending >= 0 ? `<span class="pill goal">Pt ${from + pending} · We scored · ${o[pending].start_on === "D" ? "Break" : o[pending].start_on === "O" ? "Hold" : "Goal"}</span>`
      : nowK >= 0 ? `<span class="pill now"><i></i>NOW · Pt ${from + nowK}</span>`
      : !compact && played ? `<span class="pill played">Played</span>`
      : !compact && i === nowLine + 1 ? `<span class="pill next">Up next</span>` : "";
    const stateWord = compact && pending < 0 && nowK < 0 ? (played ? "PLAYED" : i === nowLine + 1 ? "UP NEXT" : "") : "";
    const tiles = [];
    for (let k = 0; k < SLOTS; k++) {
      const s = line[k];
      if (!s) { tiles.push(`<button class="who empty" data-act="pick-slot" data-id="${pt.id}" data-k="${k}">+ Add player</button>`); continue; }
      const p = P(s.p), r = s.r === "P" ? "C" : (s.r || "");
      const gN = goals.get(s.p) || 0, aN = assists.get(s.p) || 0;
      const sat = rest && rest.any ? rest.info(s.p).pts : undefined;
      const bits = [
        s.p === spots.deep ? '<span class="t-dd">DD</span>' : s.p === spots.short ? '<span class="t-sd">SD</span>' : "",
        sat === undefined ? "" : sat === null ? '<span class="t-first">1st shift</span>' : sat === 0 ? '<span class="t-b2b">back to back</span>' : `sat ${sat}`,
        gN || aN ? `<span class="t-ga">${[gN ? (gN > 1 ? gN : "") + "G" : "", aN ? (aN > 1 ? aN : "") + "A" : ""].filter(Boolean).join(" ")}</span>` : "",
      ].filter(Boolean);
      tiles.push(`<div class="tile"><button class="who" data-act="pick-slot" data-id="${pt.id}" data-k="${k}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span><span class="tn"><span class="nm">${esc(label(p))}${badge(p)}</span><span class="tag">${bits.join(" · ") || "&nbsp;"}</span></span></button><button class="role-chip" data-r="${r}" data-act="role" data-id="${pt.id}" data-k="${k}" aria-label="Role: ${ROLE_NAME[r] || "none"}. Tap to change">${r || "–"}</button></div>`);
    }
    if (compact) {
      tiles.length = 0;
      for (let k = 0; k < SLOTS; k++) {
        const s = line[k];
        if (!s) { tiles.push(`<li><button class="who empty" data-act="pick-slot" data-id="${pt.id}" data-k="${k}">+ Add player</button></li>`); continue; }
        const p = P(s.p), r = s.r === "P" ? "C" : (s.r || ""), gN = goals.get(s.p) || 0, aN = assists.get(s.p) || 0;
        const sat = rest && rest.any ? rest.info(s.p).pts : undefined;
        tiles.push(`<li class="prow"><button class="who" data-act="pick-slot" data-id="${pt.id}" data-k="${k}" title="${sat === undefined ? "" : sat === null ? "1st shift" : sat === 0 ? "back to back" : "sat " + sat + " pts"}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span><span class="nm">${esc(label(p))}${badge(p)}</span>${gN || aN ? `<span class="t-ga">${[gN ? "G" : "", aN ? "A" : ""].filter(Boolean).join("")}</span>` : ""}${sat === 0 ? '<span class="t-b2b" aria-label="back to back">●</span>' : ""}<span class="grow"></span>${s.p === spots.deep ? '<span class="pos dd">DD</span>' : s.p === spots.short ? '<span class="pos sd">SD</span>' : ""}</button><button class="role-chip" data-r="${r}" data-act="role" data-id="${pt.id}" data-k="${k}" aria-label="Role: ${ROLE_NAME[r] || "none"}. Tap to change">${r || "–"}</button></li>`);
      }
    }
    const pl = podsOnLine(line.map(s => s.p));
    const lastRes = o.map((x, k) => ({ x, k })).filter(z => z.x.result).pop();
    if (!compact) tiles.push(`<div class="tile sum"><span><b class="cw">${w} W</b> · <b class="cm">${m} M</b>${caps ? ` · ${caps} cap${caps === 1 ? "" : "s"}` : ""}</span><span>${missing.length ? `<span class="warn-tag">${missing.join(" · ")}</span>` : pl.length ? `<span class="pod-tag">${pl.map(x => esc(x.name)).join(" + ")}</span>` : lastRes ? `Pt ${from + lastRes.k}: ${lastRes.x.result === "us" ? "we scored" : "they scored"}` : `${line.length}/${SLOTS}`}</span></div>`);
    if (!compact && tiles.length % 2) tiles.push("");
    const compactFoot = compact ? `<div class="cfoot"><span><b class="cw">${w} W</b> · <b class="cm">${m} M</b>${listed("deep") ? (spots.deep ? " · DD ✓" : ' · <span class="warn-tag">no DD</span>') : ""}${listed("short") ? (spots.short ? " · SD ✓" : ' · <span class="warn-tag">no SD</span>') : ""}${pl.length ? ` · <span class="pod-tag">${pl.map(x => esc(x.name)).join(" + ")}</span>` : ""}</span></div>` : "";

    const odSeg = (k, x) => `<div class="seg disp" role="group" aria-label="Point ${from + k}: start on offense or defense"><button data-act="od" data-id="${pt.id}" data-k="${k}" data-v="O" aria-pressed="${x.start_on === "O"}">O</button><button data-act="od" data-id="${pt.id}" data-k="${k}" data-v="D" aria-pressed="${x.start_on === "D"}">D</button></div>`;
    const resultBtns = (k, x) => `<div class="result-btns" role="group" aria-label="Point ${from + k}: result"><button class="us" data-act="result" data-id="${pt.id}" data-k="${k}" data-v="us" aria-pressed="${x.result === "us"}">We scored</button><button class="them" data-act="result" data-id="${pt.id}" data-k="${k}" data-v="them" aria-pressed="${x.result === "them"}">They scored</button></div>`;
    const resText = x => x.result === "us" ? (x.start_on === "D" ? "Break" : x.start_on === "O" ? "Hold" : "We scored") : x.start_on === "O" ? "Broken" : "They scored";
    const gaText = x => x.result === "us" && x.scorer ? `<span class="goal">${esc(label(P(x.scorer)))}${x.assist && x.assist !== "none" ? " from " + esc(label(P(x.assist))) : x.assist === "none" ? ", no assist" : ""}</span>` : "";
    const tileBtn = (act, k, s, extraCls, tag) => { const p = P(s.p); return `<button class="ga-btn ${extraCls || ""}" data-act="${act}" data-id="${pt.id}" data-k="${k}" data-p="${s.p}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span>${esc(label(p))}${tag ? `<span class="gtag">${tag}</span>` : ""}</button>`; };
    const ptBlock = (k, x) => {
      const open = ui.openPt === pt.id + ":" + k;
      // A goal still waiting for its scorer / thrower.
      if (x.result === "us" && !(x.scorer && x.assist)) {
        if (!line.length) return `<div class="pt-block"><p class="muted" style="margin:0">Pt ${from + k}: we scored. Add players to record the goal.</p></div>`;
        if (!x.scorer) return `<div class="pt-block${k === pending ? " now" : ""}"><div class="pt-title"><b>Who scored?</b><span>Pt ${from + k}</span></div><div class="ga-grid">${line.map(s => tileBtn("set-goal", k, s)).join("")}</div>
          <div class="ga-links"><span></span><button class="quiet" data-act="result" data-id="${pt.id}" data-k="${k}" data-v="us">Undo this point</button></div></div>`;
        return `<div class="pt-block${k === pending ? " now" : ""}"><div class="pt-title"><b>Who threw it?</b><span>Goal: ${esc(label(P(x.scorer)))}</span></div><div class="ga-grid">${line.map(s => s.p === x.scorer ? tileBtn("ga-change", k, s, "scorer", "GOAL") : tileBtn("set-assist", k, s)).join("")}<button class="ga-btn none" data-act="set-assist" data-id="${pt.id}" data-k="${k}" data-p="none">No assist</button></div>
          <div class="ga-links"><button data-act="ga-change" data-id="${pt.id}" data-k="${k}">Change scorer</button><button class="quiet" data-act="result" data-id="${pt.id}" data-k="${k}" data-v="us">Undo this point</button></div></div>`;
      }
      if (k === nowK) return `<div class="pt-block now" id="nowRow"><div class="od-row"><span class="pt-n disp">Pt ${from + k}</span><span class="grow"></span><span class="lbl">Start on</span>${odSeg(k, x)}</div>${resultBtns(k, x)}</div>`;
      if (open) return `<div class="pt-row open"><div class="od-row"><span class="pt-n disp">Pt ${from + k}</span><span class="grow"></span><span class="lbl">Start on</span>${odSeg(k, x)}<button class="pt-edit" data-act="pt-open" data-id="${pt.id}" data-k="${k}">Done</button></div>${resultBtns(k, x)}${x.result === "us" ? `<div class="ga-links"><button data-act="ga-change" data-id="${pt.id}" data-k="${k}">Change scorer</button></div>` : ""}</div>`;
      if (!x.result && !started) return "";   // a line that hasn't started: nothing to record yet
      return `<div class="pt-row"><span class="pt-n">Pt ${from + k}</span>${x.start_on ? `<span class="od">${x.start_on}</span>` : ""}${x.result ? `<span class="res ${x.result}">${resText(x)}</span>${gaText(x)}` : '<span class="muted">not played yet</span>'}<button class="pt-edit" data-act="pt-open" data-id="${pt.id}" data-k="${k}">Edit</button></div>`;
    };
    return `<article class="point${compact ? " compact" : ""}${ctx.dark ? " dark" : ""}${played ? " played" : ""}${nowK >= 0 ? " current" : ""}" data-line="${i}">
      ${pill}
      <div class="card-head">
        ${!wide() ? `<button class="nav" data-act="go-line" data-dir="-1" aria-label="Previous line" ${i === 0 ? "disabled" : ""}>‹</button>` : ""}
        <span class="ln">Line ${i + 1}</span><span class="lp">${n === 1 ? "Pt " + from : "Pts " + from + "–" + to}</span>
        <span class="grow"></span>${stateWord ? `<span class="state ${played ? "" : "next"}">${stateWord}</span>` : ""}
        ${ui.clip && !started ? `<button class="btn sm" data-act="paste-line" data-id="${pt.id}">Paste</button>` : ""}
        <button class="icon-btn" data-act="point-menu" data-id="${pt.id}" aria-label="Line ${i + 1} options">⋯</button>
        ${!wide() ? `<button class="nav" data-act="go-line" data-dir="1" aria-label="Next line">›</button>` : ""}
      </div>
      ${compact ? `<ul class="prows">${tiles.join("")}</ul>${compactFoot}` : `<div class="tiles">${tiles.join("")}</div>`}
      ${line.length || started ? o.map((x, k) => ptBlock(k, x)).join("") : ""}
    </article>`;
  }

  // How many players are planned for 0, 2, 4… points this game, each bar split W / M.
  // Tap a bar to see who's in it.
  function pointsChart(lines, light) {
    const planned = plannedPoints(lines), people = activePlayers();
    if (!lines.length || !people.length) return "";
    const byCount = new Map();
    people.forEach(p => { const v = planned.get(p.id) || 0; if (!byCount.has(v)) byCount.set(v, []); byCount.get(v).push(p); });
    let groups = [...byCount.keys()].sort((a, b) => a - b).map(v => ({ key: String(v), name: v + (v === 1 ? " pt" : " pts"), players: byCount.get(v) }));
    if (groups.length > 6) {
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
      </div>`;
    }).join("");
    const few = (() => { const c = people.filter(p => !isLead(p)).map(p => ({ p, v: planned.get(p.id) || 0 })); if (!c.length) return ""; const lo = Math.min(...c.map(x => x.v)), who = c.filter(x => x.v === lo).map(x => label(x.p));
      return who.length && who.length < c.length ? `<p class="muted few" style="margin:0;font-size:14px">Fewest planned: ${esc(who.slice(0, 10).join(", "))}${who.length > 10 ? " and " + (who.length - 10) + " more" : ""}, ${lo} pt${lo === 1 ? "" : "s"} each.</p>` : ""; })();
    return `<section class="ppl${light ? " light" : ""}">
      <div class="ppl-head"><h2>Points per person</h2><span class="legend"><span><i class="key W"></i>W</span><span><i class="key M"></i>M</span></span></div>
      <p class="muted" style="margin:0;font-size:15px">Planned this game, all ${people.length} players. Tap a bar to see who.</p>
      <div class="bars">${rows}</div>
      ${few}
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
    const counts = people.map(p => ({ p, n: att.count.get(p.id) || 0 })).sort((a, b) => b.n - a.n || label(a.p).localeCompare(label(b.p)));
    const attRows = counts.map(({ p, n }) => `<div class="att-row"><span class="pl"><i class="dot ${p.gender || ""}"></i>${esc(label(p))}${badge(p)}</span><span class="att-bar"><i style="width:${att.n ? (n / att.n) * 100 : 0}%"></i></span><span class="att-n">${n}/${att.n}</span></div>`).join("");
    const inWin = new Set(att.list.map(x => x.id));
    const prRow = x => { const n = (x.attended || []).filter(id => P(id)).length; return `<li><button data-act="pr-open" data-id="${x.id}" ${x.id === ui.practiceId ? 'aria-current="true"' : ""}><span>${fmtDay(x.practice_date)}${x.practice_date === today ? " · today" : ""}</span><span class="meta">${n} here</span></button></li>`; };
    const recent = all.filter(x => inWin.has(x.id)).reverse(), older = all.filter(x => !inWin.has(x.id)).reverse();
    const attSec = `<div class="att-card"><h2>Attendance</h2><span class="muted" style="font-size:15px">${sinceText(att)} · ${plural(att.n, "practice")}. The best attendance starts the next tournament and gets a little more time. It starts over after each tournament.</span>
        ${att.n ? `<div class="att-list">${attRows}</div>` : '<p class="muted" style="margin:0">No practices checked in yet.</p>'}</div>`;
    const listSec = all.length ? `<div><h2>Practices</h2><ul class="pr-list">${recent.map(prRow).join("")}</ul>${older.length ? `<span class="eyebrow" style="display:block;margin-top:12px">Before ${esc(att.since ? att.since.name : "")}</span><ul class="pr-list">${older.map(prRow).join("")}</ul>` : ""}</div>` : "";
    if (!pr) {
      return `<div class="above"><h1 class="page-title">Practice</h1>
          <span class="page-sub">Check people in as they show up. It saves on every tap and shows live on every phone.</span>
          <div class="two-btns"><button class="btn primary" data-act="pr-new">${todays ? "Open today's check-in" : "Check in today's practice"}</button><button class="btn" data-act="pr-new-date">Add an earlier practice</button></div></div>
        ${deep(attSec + listSec)}`;
    }
    const here = new Set((pr.attended || []).filter(id => P(id))), sitting = new Set((pr.sitting || []).filter(id => here.has(id)));
    const hp = people.filter(p => here.has(p.id)), w = hp.filter(p => p.gender === "W").length, m = hp.filter(p => p.gender === "M").length;
    const sitMode = ui.prMode === "sit";
    const chip = p => { const on = here.has(p.id), out = sitting.has(p.id);
      return `<button class="chk${out ? " sitting" : ""}" data-act="pr-mark" data-p="${p.id}" aria-pressed="${on}" aria-label="${esc(label(p))}, ${out ? "here but not scrimming" : on ? "here" : "not here yet"}"${sitMode && !on ? " disabled" : ""}><span class="cdot ${p.gender || ""}">${on && !out ? "✓" : ""}</span><span class="cn"><b>${esc(label(p))}</b>${out ? "<small>NOT SCRIMMING</small>" : ""}</span></button>`; };
    const grp = (gnd, t) => { const list = people.filter(p => (p.gender || "") === gnd); if (!list.length) return ""; const n = list.filter(p => here.has(p.id)).length;
      return `<section style="display:flex;flex-direction:column;gap:8px"><span class="group-title">${t} · ${n} of ${list.length} here</span><div class="chk-grid">${list.map(chip).join("")}</div></section>`; };
    // Anyone checked in who's since been marked Out still counts; show them too.
    const extra = (pr.attended || []).filter(id => P(id) && !P(id).active).map(P);
    const sc = scrimSync(pr);
    const team = (k, name) => { const ps = sortPlayers(sc[k].map(P).filter(Boolean)), tw = ps.filter(p => p.gender === "W").length, tm = ps.filter(p => p.gender === "M").length;
      return `<div class="scrim-team ${k}"><div><b class="tn2">${name}</b><br><small>${ps.length} · ${tw} W · ${tm} M</small></div>${ps.map(p => `<span class="p"><i class="dot ${p.gender || ""}"></i>${esc(label(p))}${p.badge ? " " + p.badge : ""}</span>`).join("")}</div>`; };
    const scrim = `<div class="row" style="flex-wrap:nowrap"><h2 class="grow">Scrim teams</h2>${sc ? '<button class="btn sm on-deep" data-act="scrim-make">Shuffle</button><button class="btn sm on-deep ghost" data-act="scrim-clear">Hide</button>' : `<button class="btn sm on-deep" data-act="scrim-make" ${here.size - sitting.size < 2 ? "disabled" : ""}>Split into 2 teams</button>`}</div>
      <span class="muted" style="font-size:15px">Even women and men, captains split, handlers spread out. Late arrivals join the smaller side; anyone not scrimming drops off. Only on this phone.</span>
      ${sc ? `<div class="scrim-teams">${team("A", "Dark")}${team("B", "Light")}</div>` : ""}`;
    return `<div class="above practice-open">
        <div class="pr-top"><h1 class="page-title">Practice</h1><input class="date-pill" id="prDate" type="date" value="${esc(pr.practice_date)}" aria-label="Practice date"><span class="grow"></span><button class="btn ghost" data-act="pr-close">Done</button></div>
        <div class="here"><span class="big">${here.size}</span><span class="t"><b>here, saving live</b><span><b class="cw">${w} W</b> · <b class="cm">${m} M</b>${sitting.size ? ` · ${sitting.size} not scrimming` : ""}</span></span></div>
        <div class="seg wide disp" role="group" aria-label="What a tap does"><button data-act="pr-mode" data-v="here" aria-pressed="${!sitMode}">Check in</button><button data-act="pr-mode" data-v="sit" aria-pressed="${sitMode}">Left / not scrimming</button></div>
        ${sitMode ? '<p class="page-sub" style="margin:0">Tap anyone who left early or isn\'t scrimming. They stay checked in (it still counts as a practice) but are left off the scrim teams. Tap again to put them back.</p>' : ""}
        ${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}
        ${extra.length ? `<section style="display:flex;flex-direction:column;gap:8px"><span class="group-title">Marked out, but checked in</span><div class="chk-grid">${extra.map(chip).join("")}</div></section>` : ""}
        <div><button class="btn sm danger" data-act="pr-delete">${ui.prConfirm === pr.id ? "Tap again to delete this practice" : "Delete practice"}</button></div>
      </div>
      ${deep(scrim + attSec + listSec)}`;
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
    const lastOut = dated.filter(t => t.start_date < today).pop() || null;
    const todays = practices().find(x => x.practice_date === today);
    const att = attendanceFor(today, null);
    let hero;
    if (next) {
      const late = (Array.isArray(next.late) ? next.late : []).filter(id => P(id)).length, games = S.games.filter(g => g.tournament_id === next.id).length, d = daysUntil(next.start_date);
      hero = `<section class="home-next">
        <span class="eyebrow">Next up</span>
        <div class="countdown">${d === 0 ? `<span class="big word">Today</span><span class="to"><span>it's</span><b>${esc(next.name)}</b></span>` : `<span class="big">${d}</span><span class="to"><span>day${d === 1 ? "" : "s"} to</span><b>${esc(next.name)}</b></span>`}</div>
        <span>${fmtDay(next.start_date)}${next.location ? ` · at ${esc(next.location)}` : ""}</span>
        <div class="two-btns"><button class="btn primary" data-act="home-tour" data-id="${next.id}">${games ? "Open its games" : "Plan the first game"}</button><button class="btn" data-act="home-late" data-id="${next.id}">Late sign-ups${late ? " · " + late : ""}</button></div>
        <span class="page-sub">${att.n ? `${plural(att.n, "practice")} ${sinceText(att)} ${att.n === 1 ? "counts" : "count"} toward who starts.` : `No practices checked in ${sinceText(att)} yet.`}</span>
      </section>`;
    } else hero = `<section class="home-next"><span class="eyebrow">Next up</span><h1 class="page-title">No tournament on the calendar</h1><div class="two-btns"><button class="btn primary" data-act="home-new-tour">Add a tournament</button></div></section>`;
    const nHere = todays ? (todays.attended || []).filter(id => P(id)).length : 0;
    const practiceCard = `<section class="card today-card"><span class="t"><b>Practice today</b><span>${fmtDay(today)} · ${todays ? (nHere ? `${nHere} here` : "nobody in yet") : "not started"}</span></span><button class="pill-btn" data-act="home-practice">${todays ? "Open" : "Check in"}</button></section>`;
    const lr = lastOut ? tourRecord(lastOut) : null;
    const last = lastOut ? `<button class="last-out" data-act="home-tour" data-id="${lastOut.id}"><span class="eyebrow">Last out</span><b>${esc(lastOut.name)}</b><span>${lr.any ? `${lr.w}–${lr.l} · ${lr.us}–${lr.them} in points` : fmtDay(lastOut.start_date)}</span></button>` : "";
    const row = (t, k) => {
      const past = t.start_date && t.start_date < today, r = tourRecord(t), n = S.games.filter(g => g.tournament_id === t.id).length;
      const [y, mo, d] = (t.start_date || "").split("-").map(Number);
      const mon = y ? new Date(y, mo - 1, d).toLocaleDateString(undefined, { month: "short" }).toUpperCase() : "";
      const status = r.any ? `<span class="${r.w > r.l ? "won" : r.l > r.w ? "lost" : ""}">${r.w}–${r.l}</span>` : t.start_date ? (past ? (n ? plural(n, "game") : "no games") : whenText(t.start_date)) : "no date";
      return `<button class="sched-row sched-open n${Math.min(k + 1, 3)}" data-act="home-tour" data-id="${t.id}">
          <span class="sched-date">${y ? `<small>${mon}</small><b>${d}</b>` : "<b>–</b>"}</span>
          <span class="sched-name"><b>${esc(t.name)}</b>${t.location ? `<span>at ${esc(t.location)}</span>` : ""}</span>
          <span class="sched-status${!past && t.start_date && !r.any && k === 0 ? " soon" : ""}">${status}</span></button>`;
    };
    const upcoming = dated.filter(t => t.start_date >= today), past = dated.filter(t => t.start_date < today).reverse(), undated = tours().filter(t => !t.start_date);
    const recent = S.games.map(g => ({ g, s: computeStats(gamePoints(g.id)).team })).filter(x => x.s.played).slice(-5).reverse();
    const below = `${upcoming.length ? `<span class="eyebrow">The season ahead ↓</span><div>${upcoming.map(row).join("")}</div>` : ""}
      ${past.length ? `<span class="eyebrow" style="margin-top:10px">Played</span><div>${past.map((t, k) => row(t, k + 1)).join("")}</div>` : ""}
      ${undated.length ? `<span class="eyebrow" style="margin-top:10px">No date yet</span><div>${undated.map((t, k) => row(t, k + 1)).join("")}</div>` : ""}
      <button class="add-dashed" data-act="home-new-tour">+ Add tournament</button>
      ${recent.length ? `<span class="eyebrow" style="margin-top:14px">Recent games</span><div>${recent.map(({ g, s }) => `<button class="game-row" data-act="home-game" data-id="${g.id}"><span class="gn"><b>${esc(g.name)}</b>${tourOf(g) ? `<span>${esc(tourOf(g).name)}</span>` : ""}</span><span class="gs ${s.us > s.them ? "won" : s.them > s.us ? "lost" : ""}">${s.us}–${s.them}</span></button>`).join("")}</div>` : ""}`;
    return `<div class="above">${hero}${practiceCard}${last}</div>${deep(below)}`;
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
  // Open a tournament's page: its games, in play order.
  function openTour(tid) {
    ui.tourId = tid; store.set("tourId", tid); ui.tab = "tour"; store.set("tab", "tour"); render(); window.scrollTo(0, 0);
  }
  function renderTour() {
    const t = tours().find(x => x.id === ui.tourId);
    if (!t) { ui.tab = "home"; return renderHome(); }
    const today = todayISO(), gs = S.games.filter(g => g.tournament_id === t.id), r = tourRecord(t);
    const late = (Array.isArray(t.late) ? t.late : []).filter(id => P(id)).length;
    const when = t.start_date ? `${fmtDay(t.start_date)}${t.start_date >= today ? " · " + whenText(t.start_date) : ""}` : "No date yet";
    const card = (g, i) => {
      const lines = gamePoints(g.id), st = computeStats(lines).team, now = nowPoint(lines);
      const status = !lines.length ? "No lines yet" : !st.played ? `${plural(lines.length, "line")} planned` : now ? `In progress · Pt ${now.n} next` : `${st.played} points played`;
      const showDate = g.game_date && g.game_date !== t.start_date;
      return `<li><button class="tgame" data-act="home-game" data-id="${g.id}">
        <span class="tg-n">${i + 1}</span>
        <span class="tg-main"><b>${esc(g.name)}</b><small>${status}${showDate ? " · " + fmtDay(g.game_date) : ""}</small></span>
        ${st.played ? `<span class="tg-res"><small>${st.us > st.them ? "W" : st.them > st.us ? "L" : ""}</small><span class="tg-score ${st.us > st.them ? "won" : st.them > st.us ? "lost" : ""}">${st.us}–${st.them}</span></span>` : ""}<span class="tg-go" aria-hidden="true">›</span></button></li>`;
    };
    const dated = tours().filter(x => x.start_date).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    const nextT = dated.find(x => x.start_date >= today && x.id !== t.id && (!t.start_date || x.start_date > t.start_date)) || null;
    const nextGames = nextT ? S.games.filter(g => g.tournament_id === nextT.id).length : 0;
    return `<div class="above">
        <button class="back-link" data-act="tab" data-tab="home">‹ Home</button>
        <div class="tour-head"><div style="min-width:0"><h1>${esc(t.name)}</h1><span class="page-sub">${when}${t.location ? ` · at ${esc(t.location)}` : ""}</span></div>
          ${r.any ? `<div class="rec"><b>${r.w}–${r.l}</b><small>${r.us}–${r.them} in points</small></div>` : ""}</div>
        <div class="tour-btns"><button class="btn primary" data-act="tour-add-game" data-id="${t.id}">+ Add game</button><button class="btn" data-act="home-late" data-id="${t.id}">Late sign-ups${late ? " (" + late + ")" : ""}</button>${gs.some(g => computeStats(gamePoints(g.id)).team.played) ? `<button class="btn" data-act="tour-stats" data-id="${t.id}">Stats</button>` : ""}<button class="btn ghost" data-act="home-edit-tour" data-id="${t.id}">Edit</button></div>
        ${gs.length ? `<span class="eyebrow">Games in play order</span><ul class="tgames">${gs.map(card).join("")}</ul>` : `<div class="tgames-empty"><p><b>No games yet.</b></p><p class="muted">Add the first game to start planning lines. You can add the rest as the schedule comes out.</p></div>`}
      </div>
      ${nextT ? deep(`<span class="eyebrow">Next up ↓</span><button class="next-link" data-act="home-tour" data-id="${nextT.id}"><span class="t"><b>${esc(nextT.name)}</b><span>${fmtDay(nextT.start_date)}${nextGames ? "" : " · no games yet"}</span></span><span class="soon">${whenText(nextT.start_date)} ›</span></button>`) : ""}`;
  }
  function openGame(gid) {
    ui.gameId = gid; store.set("game", gid); ui.swipe = null; ui.editLines = null; ui.undoDel = null;
    ui.tab = "points"; store.set("tab", "points"); render(); window.scrollTo(0, 0);
  }

  // ---------- pods: groups of players sent out together ----------
  // Stored on the team as [{ id, name, ids: [player ids] }].
  const podsOf = () => (S.team && Array.isArray(S.team.pods) ? S.team.pods : []);
  function savePods(fn) {
    const next = JSON.parse(JSON.stringify(podsOf())); fn(next);
    save("app_save_team_pods", { p: next }, () => { S.team.pods = next; });
  }
  const podCounts = ids => { const ps = ids.map(P).filter(Boolean), hz = new Set([...(zoneOf().handlers || []), ...(zoneOf().handlers_ok || [])]);
    return { n: ps.length, w: ps.filter(p => p.gender === "W").length, m: ps.filter(p => p.gender === "M").length, h: ps.filter(p => hz.has(p.id)).length, c: ps.filter(p => p.badge).length }; };
  const countText = c => `${c.n} · ${c.w} W · ${c.m} M${c.h ? ` · ${c.h} handler${c.h === 1 ? "" : "s"}` : ""}${c.c ? ` · ${c.c} capt` : ""}`;
  const nextPodName = () => { const used = new Set(podsOf().map(x => x.name)); for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has("Pod " + ch)) return "Pod " + ch; return "Pod " + (podsOf().length + 1); };
  // Pods whose whole group is on a line.
  const podsOnLine = ids => { const on = new Set(ids); return podsOf().filter(x => x.ids.length && x.ids.every(id => on.has(id))); };
  function renderPods() {
    const inPods = new Map(); podsOf().forEach(x => x.ids.forEach(id => inPods.set(id, (inPods.get(id) || 0) + 1)));
    const cards = podsOf().map(x => {
      const c = podCounts(x.ids);
      return `<div class="deep-card darker"><div class="zone-h"><b>${esc(x.name)}</b><small>${countText(c)}</small><span class="grow"></span><button class="icon-btn" style="color:var(--foam2)" data-act="pod-edit" data-id="${x.id}" aria-label="Edit ${esc(x.name)}">⋯</button></div>
        <div class="zchips">${x.ids.map(id => { const p = P(id); return p ? `<span class="zchip" style="padding-right:12px"><i class="dot ${p.gender || ""}"></i>${esc(label(p))}</span>` : ""; }).join("") || '<span class="muted">Nobody yet.</span>'}</div></div>`;
    }).join("");
    const left = activePlayers().filter(p => !inPods.has(p.id));
    return `<div id="podsSec" style="display:flex;flex-direction:column;gap:12px"><div><h2>Pods</h2><span class="muted" style="font-size:15px">2–3 players who go out together. On a line's ⋯ menu, "Put pods on this line" fills it from two or more pods.</span></div>
      ${cards}
      <button class="add-dashed" data-act="pod-new">+ New pod</button>
      ${podsOf().length && left.length ? `<span class="muted" style="font-size:14px">Not in a pod yet: ${sortPlayers(left).map(p => esc(label(p))).join(", ")}.</span>` : ""}</div>`;
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
    const th = (id, txt, full) => `<th data-act="sort" data-k="${id}" ${k === id ? 'aria-sort="descending"' : ""}${full ? ` title="${full}"` : ""}>${txt}${k === id ? " ↓" : ""}</th>`;
    const z = n => n ? `<td>${n}</td>` : '<td class="z">·</td>';
    const body = rows.map(r => { const p = P(r.id); return `<tr><td><span class="pl" title="${esc(p ? p.name : "")}"><i class="dot ${p?.gender || ""}"></i>${esc(p ? label(p) : "Removed player")}${badge(p)}</span></td><td>${r.pts}</td>${z(r.o)}${z(r.d)}${z(r.g)}${z(r.a)}</tr>`; }).join("");
    const what = sc === "game" && g ? `${esc(g.name)} · ${plural(team.played, "point")} recorded${(() => { const now = nowPoint(pts); return now ? `, Pt ${now.n} on now` : ""; })()}` : sc === "tour" ? `${esc(t.name)} · ${plural(team.played, "point")}` : `All games · ${plural(team.played, "point")}`;
    // Below the water, for one game: who hasn't been on yet.
    let below = "";
    if (sc === "game" && g) {
      const playedIds = new Set(rows.map(r => r.id)), not = activePlayers().filter(p => !playedIds.has(p.id));
      const lines = gamePoints(g.id), now = nowPoint(lines);
      if (not.length) {
        const byLine = new Map(); lines.forEach((ln, i) => (ln.lineup || []).forEach(s => { if (!byLine.has(s.p) && !outs(ln).some(o => o.result)) byLine.set(s.p, i); }));
        const nextIdx = now ? now.line : -1, onNext = not.filter(p => byLine.get(p.id) === nextIdx || (nextIdx >= 0 && byLine.get(p.id) === nextIdx + 1 && false)), later = not.filter(p => byLine.has(p.id) && !onNext.includes(p)), none = not.filter(p => !byLine.has(p.id));
        const names = ps => esc(ps.map(p => label(p)).join(", "));
        below = deep(`<span class="eyebrow">Not on yet this game · ${not.length}</span><span style="font-size:16px">${[onNext.length ? `${names(onNext)} ${onNext.length === 1 ? "is" : "are"} on Line ${nextIdx + 1}.` : "", later.length ? `${names(later)} ${later.length === 1 ? "is" : "are"} in later lines.` : "", none.length ? `${names(none)} ${none.length === 1 ? "isn't" : "aren't"} on any line.` : ""].filter(Boolean).join(" ")}</span>`);
      }
    }
    return `<div class="above">
        <div><h1 class="page-title">Stats</h1><span class="page-sub">For captains · players don't see this</span></div>
        <div class="seg wide" role="group" aria-label="Which games">
          <button data-act="stats-scope" data-v="game" aria-pressed="${sc === "game"}">This game</button>
          ${t ? `<button data-act="stats-scope" data-v="tour" aria-pressed="${sc === "tour"}">Tournament</button>` : ""}
          <button data-act="stats-scope" data-v="all" aria-pressed="${sc === "all"}">All games</button>
        </div>
        <span class="page-sub">${what}</span>
        <div class="team-tiles">
          <div><b>${team.us}–${team.them}</b><span>Score</span></div>
          <div><b>${team.holds}/${team.oPts}</b><span>Holds on O</span></div>
          <div><b>${team.breaks}/${team.dPts}</b><span>Breaks on D</span></div>
          <div><b>${team.played}</b><span>Points played</span></div>
        </div>
        ${rows.length ? `<div class="table-card"><table class="stats">
          <thead><tr>${th("name", "Player")}${th("pts", "Pts", "Points played")}${th("o", "O", "Started on offense")}${th("d", "D", "Started on defense")}${th("g", "G", "Goals")}${th("a", "A", "Assists")}</tr></thead>
          <tbody>${body}</tbody></table></div>
          <p class="legend-note">Pts = points played · O / D = points started on offense / defense · G = goals · A = assists. Tap a column to sort.</p>` : `<p class="empty-note">Stats appear once a point has a result. Tap "We scored" or "They scored" on a point.</p>`}
      </div>${below}`;
  }

  // ---------- render: roster ----------
  function renderZone() {
    const z = zoneOf();
    const chip = (k, id, i, name) => { const p = P(id); return `<span class="zchip${/_ok$/.test(k) ? " backup" : ""}"><i class="dot ${p?.gender || ""}"></i>${esc(label(p))}<button data-act="zone-remove" data-z="${k}" data-i="${i}" aria-label="Remove ${esc(label(p))} from ${name}">×</button></span>`; };
    const cards = ZONES.map(([k, name]) => `<div class="deep-card">
        <div class="zone-h"><b>${name}</b></div>
        <div class="zchips">${(z[k] || []).map((id, i) => chip(k, id, i, name)).join("")}<button class="zadd" data-act="zone-add" data-z="${k}">+ Add</button></div>
        <span class="zone-ok">If needed:</span>
        <div class="zchips">${(z[k + "_ok"] || []).map((id, i) => chip(k + "_ok", id, i, name + " backups")).join("")}<button class="zadd" data-act="zone-add" data-z="${k}_ok">+ Add backup</button></div>
      </div>`).join("");
    return `<div><h2>Zone spots</h2><span class="muted" style="font-size:15px">The line maker puts 2 handlers, a deep deep and a short deep on every line, using backups only when nobody on the main list fits. Anyone can play cup.</span></div>${cards}`;
  }
  function renderRoster() {
    const q = ui.rosterFilter.toLowerCase();
    const list = sortPlayers(S.players).filter(p => !q || p.name.toLowerCase().includes(q) || (p.nick || "").toLowerCase().includes(q));
    const all = S.players.filter(p => p.active), nw = all.filter(p => p.gender === "W").length, nm = all.filter(p => p.gender === "M").length;
    const grp = (gnd, title) => {
      const ps = list.filter(p => (p.gender || "") === gnd);
      return ps.length ? `<section style="display:flex;flex-direction:column;gap:8px"><span class="group-title">${title} · ${ps.length}</span><div class="ptiles">${ps.map(p => `<button class="ptile${p.active ? "" : " inactive"}" data-act="p-edit" data-id="${p.id}" aria-label="Edit ${esc(label(p))}"><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span><span class="nm">${esc(label(p))}${badge(p)}</span>${p.active ? "" : '<span class="out">OUT</span>'}<span class="go" aria-hidden="true">›</span></button>`).join("")}</div></section>` : "";
    };
    const link = location.origin + location.pathname + "?t=" + TOKEN;
    const settings = `<div class="deep-card abyss settings-card"><h2 style="margin:0">Share the board</h2><span class="muted" style="font-size:15px">Send teammates this link and the passcode separately. Anyone with both can view and edit.</span><div class="mono" id="shareLink">${esc(link)}</div><div class="row"><button class="btn sm on-deep" data-act="copy-link">Copy link</button></div></div>
      <div class="deep-card abyss settings-card"><h2 style="margin:0">Change passcode</h2><form id="codeForm"><input class="line-in" id="newCode" placeholder="New passcode (4+ characters)" autocomplete="off"><button class="btn on-deep" type="submit">Change</button></form><span class="muted" style="font-size:14px">Everyone else will be asked for the new one.</span></div>
      <div class="deep-card abyss settings-card"><h2 style="margin:0">This device</h2><div class="row"><button class="btn sm on-deep" data-act="logout">Forget passcode on this device</button></div></div>`;
    return `<div class="above">
        <div><h1 class="page-title">Roster</h1><span class="page-sub">${plural(all.length, "player")} · <b class="cw">${nw} W</b> · <b class="cm">${nm} M</b></span></div>
        <form class="add-form" id="addForm">
          <b class="t">Add a player</b>
          <div class="two"><label>Nickname<input class="line-in" id="addNick" value="${esc(ui.addNick || "")}" placeholder="On the board" maxlength="30"></label><label>Full name<input class="line-in" id="addName" value="${esc(ui.addName || "")}" placeholder="Optional" maxlength="60"></label></div>
          <div class="row"><div class="seg inset" role="group" aria-label="Matching"><button type="button" data-act="add-g" data-v="W" aria-pressed="${ui.addG === "W"}"><span class="cw">●</span> W</button><button type="button" data-act="add-g" data-v="M" aria-pressed="${ui.addG !== "W"}"><span style="color:var(--m-light)">●</span> M</button></div><button class="btn primary grow" type="submit">Add</button></div>
        </form>
        <input class="search" id="rosterFilter" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search players" aria-label="Search players" value="${esc(ui.rosterFilter)}">
        ${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}
        <p class="legend-note">Tap a player to change their name, W/M, captain or president badge, mark them out, or remove them.</p>
      </div>
      ${deep(renderZone() + renderPods() + privateCard() + settings)}`;
  }

  // ---------- sheets (picker, menus, forms) ----------
  function openSheet(s) { ui.sheet = s; renderSheet(); setTimeout(() => { const f = $("#sheet-root [autofocus]"); if (f && matchMedia("(min-width:760px)").matches) f.focus(); }, 30); }
  function closeSheet() { const s = ui.sheet; ui.sheet = null; renderSheet(); if (s && s.type === "ratio" && s.resolve) s.resolve("keep"); setTimeout(() => { if (typeof checkVersion === "function") checkVersion(); }, 300); }

  function renderSheet() {
    const root = $("#sheet-root"), s = ui.sheet;
    if (!s) { root.innerHTML = ""; return; }
    let title = "", sub = "", tools = "", body = "";
    const btns = (main, mainAttr, cancel) => `<div class="sheet-btns"><button class="btn primary" ${mainAttr}>${main}</button>${cancel === false ? "" : `<button class="btn" type="button" data-act="close">${cancel || "Cancel"}</button>`}</div>`;
    if (s.type === "pick") {
      const g = game(), pts = g ? gamePoints(g.id) : [];
      const planned = plannedPoints(pts);
      let taken = new Set();
      if (s.pointId) { const pt = S.points.find(x => x.id === s.pointId); (pt?.lineup || []).forEach(x => taken.add(x.p)); }
      const zMain = s.zone ? s.zone.replace(/_ok$/, "") : "";
      if (s.zone) taken = new Set([...(zoneOf(g)[zMain] || []), ...(zoneOf(g)[zMain + "_ok"] || [])]);
      const podSel = s.pod ? podsOf().find(x => x.id === s.pod) : null;
      if (podSel) taken = new Set(podSel.ids);
      const q = (s.q || "").toLowerCase(), f = s.f || "";
      // Picking for a line (not a zone or pod): how long each person has sat and how many lines
      // they've played, sortable by either, once there's an earlier line or game to go on.
      const lineIdx = s.pointId && !s.zone && !s.pod ? pts.findIndex(x => x.id === s.pointId) : -1;
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
      const att = !s.zone && !s.pod && g ? attendanceForGame(g) : null, lateSet = !s.zone && !s.pod ? lateOf(g) : new Set();
      const extra = p => [att && att.n ? `<span class="att-mini">${att.count.get(p.id) || 0}/${att.n} practices</span>` : "", lateSet.has(p.id) ? '<span class="late-mini">late sign-up</span>' : ""].filter(Boolean).join(" · ");
      const meta = p => {
        if (s.pod) { if (taken.has(p.id)) return `<span class="lead">in this pod</span>`; const o = podsOf().filter(x => x.id !== s.pod && x.ids.includes(p.id)).map(x => esc(x.name)); return o.length ? "in " + o.join(", ") : ""; }
        if (s.zone) return taken.has(p.id) ? `<span class="lead">${(zoneOf(g)[zMain] || []).includes(p.id) ? "main list" : "backup"}</span>` : "";
        if (taken.has(p.id)) return `<span class="lead">on this line</span>`;
        if (!rest) return `<span class="lead">${planned.get(p.id) || 0} pts planned</span>${extra(p) ? `<span>${extra(p)}</span>` : ""}`;
        const v = rest.info(p.id);
        const lead = v.pts === null ? `<span class="lead first">not in yet</span>` : v.pts === 0 ? `<span class="lead b2b">just played</span>` : `<span class="lead">sat ${plural(v.lines, "line")} (${plural(v.pts, "pt")})</span>`;
        return `${lead}<span>${[v.played ? plural(v.played, "line") + " played" : "", extra(p)].filter(Boolean).join(" · ")}</span>`;
      };
      const item = p => `<li><button data-act="pick" data-p="${p.id}" ${taken.has(p.id) ? "disabled" : ""}><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span><span class="nm">${esc(label(p))}${badge(p)}</span><span class="meta">${meta(p)}</span></button></li>`;
      const sec = (gnd, t) => { const items = list.filter(p => (p.gender || "") === gnd).map(item).join(""); return items ? `<li class="pick-group">${t}</li>${items}` : ""; };
      if (podSel) { title = "Add to " + esc(podSel.name); sub = "Tap people to add them. Done when finished."; }
      else if (s.zone) { title = "Add to " + zoneName(s.zone); }
      else if (s.current) {
        title = "Swap " + esc(label(P(s.current)));
        const sp = (() => { const pt = S.points.find(x => x.id === s.pointId); if (!pt) return ""; const ids = (pt.lineup || []).map(x => x.p), a = DBLines.assignSpots(ids, zoneSets()), slot = (pt.lineup || []).find(x => x.p === s.current);
          return [slot && slot.r === "H" ? "handler" : slot && slot.r === "C" ? "cutter" : "", a.deep === s.current ? "deep deep" : a.short === s.current ? "short deep" : ""].filter(Boolean).join(" · "); })();
        sub = `Line ${lineIdx + 1}${sp ? " · " + sp : ""}`;
      } else { title = "Add player"; sub = lineIdx >= 0 ? `Line ${lineIdx + 1}` : ""; }
      tools = `${s.current ? `<button class="take-off" data-act="pick-remove">Take ${esc(label(P(s.current)))} off this line</button>` : ""}
        <div class="row"><input class="line-in" id="pickQ" placeholder="Search" aria-label="Search players" value="${esc(s.q || "")}" autofocus autocomplete="off"><div class="seg inset" role="group" aria-label="Show"><button data-act="pick-f" data-v="" aria-pressed="${!f}">All</button><button data-act="pick-f" data-v="W" aria-pressed="${f === "W"}">W</button><button data-act="pick-f" data-v="M" aria-pressed="${f === "M"}">M</button></div></div>
        ${rest ? `<div class="row"><span class="muted" style="font-size:15px;font-weight:700">Sort</span><div class="seg inset" role="group" aria-label="Sort">${[["sat", "Lines sat"], ["played", "Lines played"], ["az", "A–Z"]].map(([v, t]) => `<button data-act="pick-sort" data-v="${v}" aria-pressed="${sortBy === v}">${t}</button>`).join("")}</div></div>` : ""}`;
      body = `<ul class="pick-list">${sec("W", "Women-matching")}${sec("M", "Men-matching")}${sec("", "Matchup not set")}</ul>
        ${list.length ? "" : '<p class="empty-note">Nobody matches.</p>'}${podSel || s.zone ? `<div style="margin-top:12px">${btns("Done", podSel ? `data-act="pod-edit" data-id="${podSel.id}"` : 'data-act="close"', false)}</div>` : ""}`;
    } else if (s.type === "point-menu") {
      const pts = gamePoints(ui.gameId), i = pts.findIndex(x => x.id === s.id), pt = pts[i], cur = pt ? playsOf(pt) : 2, played = pt && outs(pt).some(o => o.result);
      const from = lineStarts(pts)[i] || 1;
      title = "Line " + (i + 1); sub = `${cur === 1 ? "Pt " + from : "Pts " + from + "–" + (from + cur - 1)} · ${played ? "played" : "not played yet"}`;
      const it = (act, t, hint) => `<button data-act="${act}">${t}${hint ? `<small>${hint}</small>` : ""}</button>`;
      body = `<div class="menu-list">
        <div class="plays-row"><span>Plays</span><div class="circles" role="group" aria-label="Points this line plays">${[1, 2, 3, 4].map(v => `<button data-act="pm-plays" data-v="${v}" aria-pressed="${cur === v}">${v}</button>`).join("")}</div><span class="muted">point${cur === 1 ? "" : "s"}</span></div>
        ${pt && !played ? `<div class="menu-block">${it("pm-suggest", "Suggest players for the empty spots", (pt.lineup || []).length >= SLOTS ? "none empty" : "")}${podsOf().length ? it("pm-pods", "Put pods on this line") : ""}</div>` : ""}
        <div class="menu-block">${it("pm-copy", "Copy players", "paste on any line")}${it("pm-dup", "Duplicate at the end")}${it("pm-insert", "Insert a copy after")}</div>
        <div class="menu-block">${it("pm-clear-result", "Clear results")}${it("pm-clear", "Clear players")}</div>
        <div class="move-row">${i > 0 ? '<button data-act="pm-up">‹ Move earlier</button>' : ""}${i < pts.length - 1 ? '<button data-act="pm-down">Move later ›</button>' : ""}</div>
        <button class="menu-del${s.confirm ? " armed" : ""}" data-act="pm-delete">${s.confirm ? "Tap again to delete Line " + (i + 1) : "Delete line · tap twice"}</button>
      </div>`;
    } else if (s.type === "game-menu") {
      const g = game(), t = tourOf(g);
      const gi = t && g ? S.games.filter(x => x.tournament_id === t.id).findIndex(x => x.id === g.id) : -1, gn = t ? S.games.filter(x => x.tournament_id === t.id).length : 0;
      title = g ? esc(g.name) : "Games"; sub = t && g ? `${esc(t.name)} · game ${gi + 1} of ${gn}` : "";
      const it = (act, txt, hint, cls) => `<button data-act="${act}"${cls ? ` class="${cls}"` : ""}>${txt}${hint ? `<small>${hint}</small>` : ""}</button>`;
      body = `<div class="menu-list">
        ${g ? '<button class="menu-hero" data-act="fill-open">Fill lines automatically</button>' : ""}
        ${g ? `<div class="menu-group"><span class="eyebrow">This game</span><div class="menu-block">${gamePoints(g.id).length ? it("edit-lines", "Edit lines", "Reorder, or select several to delete") : ""}${t ? it("late-open", "Late sign-ups for this tournament", lateOf(g).size ? plural(lateOf(g).size, "late sign-up") : "") : ""}${it("edit-game", "Edit game", "Name, tournament, date")}${t ? "" : it("copy-game", "New game copying these lines")}</div></div>` : ""}
        <div class="menu-group"><span class="eyebrow">New</span><div class="menu-block">${t ? it("copy-game", "Next game in this tournament", "Starts with these lines") + it("new-game-tour", "New empty game in " + esc(t.name)) : ""}${it("new-game", "New game")}${it("new-tour", "New tournament")}</div></div>
        ${t ? `<div class="menu-group"><span class="eyebrow">Tournament</span><div class="menu-block">${it("edit-tour", "Edit " + esc(t.name), "Name, date, where")}${s.confirm === "tour" ? removeChoices(t, "delete-tour", "") : it("delete-tour", "Remove " + esc(t.name), "", "danger")}</div></div>` : ""}
        ${g ? `<button class="menu-del${s.confirm === "game" ? " armed" : ""}" data-act="delete-game">${s.confirm === "game" ? "Tap again to delete " + esc(g.name) + " and its lines" : "Delete this game · tap twice"}</button>` : ""}
      </div>`;
    } else if (s.type === "game-form") {
      const g = s.id ? S.games.find(x => x.id === s.id) : null;
      const src = s.copyFrom ? S.games.find(x => x.id === s.copyFrom) : game();
      const tid = g ? (g.tournament_id || "") : (s.tour !== undefined ? s.tour : (src?.tournament_id || ""));
      const sameTour = src && src.tournament_id && src.tournament_id === tid;
      const date = g ? (g.game_date || "") : (tid ? ((sameTour && src.game_date) || tours().find(t => t.id === tid)?.start_date || "") : "");
      title = g ? "Edit game" : s.copyFrom ? "Next game" : "New game";
      if (s.copyFrom) sub = "Starts with the same lines";
      body = `<form class="form" id="gameForm">
        <label>Name<input class="line-in" id="gName" value="${esc(g ? g.name : "")}" placeholder="e.g. vs Haverford" maxlength="80" autofocus required></label>
        <label>Tournament<select class="line-in" id="gTour"><option value="">None</option>${tours().map(t => `<option value="${t.id}" ${t.id === tid ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        <label>Date<input class="line-in" id="gDate" type="date" value="${esc(date)}"></label>
        ${g || s.copyFrom ? "" : '<p class="note">Starts with no lines. To start from a game\'s lines, use "Next game in this tournament" in the game menu.</p>'}
        ${btns(g ? "Save" : "Create", 'type="submit"')}
      </form>`;
    } else if (s.type === "fill") {
      const g = game(), zz = zoneOf(g), zoneSet = ZONES.some(([k]) => (zz[k] || []).length || (zz[k + "_ok"] || []).length);
      const nLines = g ? gamePoints(g.id).length : 0, mk = s.n ? (s.n === 1 ? `makes Line ${nLines + 1}` : `makes Lines ${nLines + 1}–${nLines + s.n}`) : "only fills empty spots";
      title = "Fill lines";
      const att = attendanceForGame(g), late = lateOf(g);
      body = `<div class="form">
        <div class="fill-pair"><span>Add new lines <span class="muted" style="font-weight:400">· ${mk}</span></span>
          <div class="circles" role="group" aria-label="New lines">${[0, 1, 2, 3, 4, 6].map(v => `<button data-act="fill-n" data-v="${v}" aria-pressed="${s.n === v}">${v}</button>`).join("")}</div></div>
        <div class="plays-row"><span class="grow">Each plays</span><div class="seg inset disp" role="group" aria-label="Points per new line">${[1, 2, 3].map(v => `<button data-act="fill-plays" data-v="${v}" aria-pressed="${s.plays === v}">${v}</button>`).join("")}</div><span class="muted">point${s.plays === 1 ? "" : "s"}</span></div>
        <div class="fill-pair"><span>Captain pairs</span>
          <div class="seg inset wide" role="group" aria-label="Captain pairs">${[["rotate", "Rotate"], ["usual", "Mostly usual"], ["rest", "Same pairs"]].map(([v, t]) => `<button data-act="fill-pairing" data-v="${v}" aria-pressed="${ui.pairing === v}">${t}</button>`).join("")}</div>
          <p class="fill-pair-note">${ui.pairing === "rotate" ? "Each captain goes out with whoever they've played with least today, so everyone plays with everyone."
            : ui.pairing === "usual" ? (() => { const up = DBLines.usualPairs(S.players, S.points); return up.length ? `Usual pairs two rounds out of three, then a mixed round: ${up.map(([a, b]) => esc(label(P(a))) + " + " + esc(label(P(b)))).join(" · ")}.` : "No usual pairs yet. Once captains have played together a few times, they'll show here."; })()
            : "Whoever has rested longest goes out together, so the same pairs tend to come back every few lines."}</p></div>
        <label class="fill-check"><input type="checkbox" id="fillAtt" ${ui.useAtt ? "checked" : ""}><span>Practice attendance counts<small>${att.n ? `Best attendance starts and gets a little more time. ${plural(att.n, "practice")} ${sinceText(att)}: someone at every practice gets about 1–2 more points a day than average.` : `No practices checked in ${sinceText(att)}, so this does nothing yet.`}</small></span></label>
        ${late.size ? `<div class="fill-pair"><span>Late sign-ups (${late.size})</span>
          <div class="seg inset wide" role="group" aria-label="Late sign-ups">${[["start", "Start later"], ["less", "Start later + less time"]].map(([v, t]) => `<button data-act="fill-late" data-v="${v}" aria-pressed="${ui.lateMode === v}">${t}</button>`).join("")}</div>
          <p class="fill-pair-note">${ui.lateMode === "less" ? "They go out after everyone's first shift and play a couple fewer points over the day." : "They go out after everyone's first shift, then rotate like everyone else."} ${[...late].map(id => esc(label(P(id)))).join(", ")}.</p></div>` : ""}
        <label class="fill-check"><input type="checkbox" id="fillExisting" ${s.existing ? "checked" : ""}><span>Also fill empty spots in lines that haven't been played</span></label>
        <ul class="fill-rules"><li class="eyebrow" style="display:block">Every line gets</li>
          <li>2 captains or president, whoever has rested longest goes first</li>
          <li>3 women and 4 men (asks first if the men fall a point behind over the day)</li>
          <li>${zoneSet ? "2 handlers, a deep deep and a short deep, from Zone spots" : `<b>No zone spots set.</b> Add handlers, deep deeps and short deeps under Zone spots on the Roster tab.`}</li>
          <li>Nobody back to back; people who are out are skipped</li>
          ${ui.owner ? "<li>Your private settings</li>" : ""}
          <li>Players you've placed stay put. Lines with results aren't touched.</li>
        </ul>
        ${btns(s.n ? (s.n === 1 ? `Fill Line ${nLines + 1}` : `Fill Lines ${nLines + 1}–${nLines + s.n}`) : "Fill empty spots", 'data-act="fill-go"')}
      </div>`;
    } else if (s.type === "ratio") {
      title = "Men are sitting longer"; sub = "While filling lines";
      const mx = Math.max(s.w, s.m, 0.1);
      body = `<div class="form">
        <p class="note">Average points played so far today, not counting captains and president:</p>
        <div class="ratio-bars"><div class="rb"><span class="rb-h"><span>Women</span><span><b>${s.w.toFixed(1)}</b> pts</span></span><span class="rb-t"><i style="width:${(s.w / mx) * 100}%;background:var(--w)"></i></span></div>
          <div class="rb"><span class="rb-h"><span>Men</span><span><b>${s.m.toFixed(1)}</b> pts</span></span><span class="rb-t"><i style="width:${(s.m / mx) * 100}%;background:var(--m)"></i></span></div></div>
        <p style="margin:0;font-size:18px">Make <b>Line ${s.lineNo}</b> <b>5 men / 2 women</b> to catch up?</p>
        <div class="sheet-btns" style="flex-direction:column"><button class="btn primary" data-act="ratio-five">Yes, 5 men / 2 women</button><button class="btn" data-act="ratio-keep">Keep 4 men / 3 women</button></div>
      </div>`;
    } else if (s.type === "pods-line") {
      const g = game(), pts = g ? gamePoints(g.id) : [], idx = pts.findIndex(x => x.id === s.pointId), pt = pts[idx];
      const rest = idx >= 0 ? restFor(g, pts, idx) : null;
      const cur = (pt?.lineup || []).map(x => x.p), keep = s.keep !== false ? cur : [];
      const chosen = podsOf().filter(x => s.sel.includes(x.id));
      const ids = [...keep]; chosen.forEach(x => x.ids.forEach(id => { if (P(id) && !ids.includes(id)) ids.push(id); }));
      const c = podCounts(ids), spots = DBLines.assignSpots(ids, zoneSets());
      const restText = x => { if (!rest || !rest.any) return ""; const v = x.ids.map(id => rest.info(id).lines).filter(v => v !== undefined);
        if (!v.length) return ""; const fresh = v.filter(n => n === null).length, sat = v.filter(n => n !== null);
        return sat.length ? `sat ${Math.min(...sat)}${Math.min(...sat) !== Math.max(...sat) ? "–" + Math.max(...sat) : ""} line${Math.max(...sat) === 1 ? "" : "s"}${fresh ? ` · ${fresh} not in yet` : ""}` : "not in yet"; };
      title = "Pods for Line " + (idx + 1); sub = cur.length ? "Already on it: " + cur.map(id => { const p = P(id); return esc(label(p)) + (p?.badge ? " " + p.badge : ""); }).join(", ") : "";
      body = `<div class="form">
        <ul class="pod-pick">${podsOf().map(x => { const pc = podCounts(x.ids), b2b = rest ? x.ids.filter(id => rest.info(id).lines === 0).map(id => label(P(id))) : [];
          return `<li><button data-act="podl-toggle" data-id="${x.id}" aria-pressed="${s.sel.includes(x.id)}">
            <span class="pp-name">${s.sel.includes(x.id) ? "✓ " : ""}${esc(x.name)} <span class="pp-meta">${pc.w} W · ${pc.m} M${restText(x) ? " · " + restText(x) : ""}</span></span>
            <span class="pp-who">${x.ids.map(id => { const p = P(id); return p ? `<span><i class="dot ${p.gender || ""}"></i>${esc(label(p))}</span>` : ""; }).join("")}</span>
            ${b2b.length ? `<span class="pp-meta"><span class="b2b">${esc(b2b.join(", "))} just played</span></span>` : ""}</button></li>`; }).join("")}</ul>
        <label class="fill-check"><input type="checkbox" id="podKeep" ${s.keep !== false ? "checked" : ""}><span>Keep who's already on the line</span></label>
        <div class="pod-total ${c.n > SLOTS ? "over" : ""}"><span class="t"><b>${c.n} of ${SLOTS}</b><span><b class="cw">${c.w} W</b> · <b class="cm">${c.m} M</b>${c.n ? ` · DD ${spots.deep ? "✓" : "✗"} · SD ${spots.short ? "✓" : "✗"}` : ""}${c.n > SLOTS ? ` · ${c.n - SLOTS} too many` : ""}</span></span>
          <button class="btn primary" data-act="podl-go" ${!chosen.length || c.n > SLOTS ? "disabled" : ""}>Put on Line ${idx + 1}</button></div>
      </div>`;
    } else if (s.type === "games") {
      title = "Games";
      const row = g => { const st = computeStats(gamePoints(g.id)).team; return `<button data-act="pick-game" data-id="${g.id}" ${g.id === ui.gameId ? 'aria-current="true"' : ""}><span>${esc(g.name)}${g.game_date && !tourOf(g) ? ` <small>${fmtDate(g.game_date)}</small>` : ""}</span>${st.played ? `<small>${st.us}–${st.them}</small>` : "<small>no results yet</small>"}</button>`; };
      const groups = tours().map(t => { const gs = S.games.filter(g => g.tournament_id === t.id); return gs.length ? `<div class="menu-group"><span class="eyebrow">${esc(t.name)}</span><div class="menu-block games">${gs.map(row).join("")}</div></div>` : ""; }).reverse().join("");
      const loose = S.games.filter(g => !tourOf(g));
      body = `<div class="menu-list">${groups}${loose.length ? `<div class="menu-group"><span class="eyebrow">Other games</span><div class="menu-block games">${loose.slice().reverse().map(row).join("")}</div></div>` : ""}<button class="menu-hero" data-act="new-game">New game</button></div>`;
    } else if (s.type === "late") {
      const t = tours().find(x => x.id === s.tid);
      const late = new Set(t && Array.isArray(t.late) ? t.late : []), people = sortPlayers(activePlayers());
      title = "Late sign-ups"; sub = t ? `${esc(t.name)}${t.start_date ? " · " + fmtDay(t.start_date) : ""}` : "";
      const chip = p => `<button class="pchip" data-act="late-mark" data-p="${p.id}" aria-pressed="${late.has(p.id)}"><i class="dot ${p.gender || ""}"></i>${esc(label(p))}${late.has(p.id) ? " ✓" : ""}</button>`;
      const grp = (gnd, h) => { const list = people.filter(p => (p.gender || "") === gnd); return list.length ? `<div style="display:flex;flex-direction:column;gap:8px"><span class="group-title">${h}</span><div class="pchips">${list.map(chip).join("")}</div></div>` : ""; };
      const n = [...late].filter(id => P(id)).length;
      body = t ? `<div class="form">
        <p class="note">Tap anyone who signed up after the deadline. The line maker starts them after everyone else's first shift${ui.lateMode === "less" ? ", and gives them a couple fewer points over the day" : ""}.</p>
        ${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}
        ${btns(n ? `Done · ${plural(n, "late sign-up")}` : "Done", 'data-act="close"', false)}</div>` : '<p class="empty-note">That tournament is gone.</p>';
    } else if (s.type === "pr-date") {
      title = "Add a practice";
      body = `<form class="form" id="prDateForm">
        <label>Date<input class="line-in" id="prNewDate" type="date" value="${esc(todayISO())}" max="${esc(todayISO())}" required autofocus></label>
        ${btns("Add", 'type="submit"')}</form>`;
    } else if (s.type === "tour-form") {
      const t = s.id ? tours().find(x => x.id === s.id) : null;
      title = t ? "Edit tournament" : "New tournament";
      body = `<form class="form" id="tourForm">
        <label>Name<input class="line-in" id="tName" value="${esc(t ? t.name : "")}" placeholder="e.g. Haverford Hat" maxlength="80" autofocus required></label>
        <label>Date<input class="line-in" id="tDate" type="date" value="${esc(t?.start_date || "")}"></label>
        <label>Where<input class="line-in" id="tWhere" value="${esc(t?.location || "")}" placeholder="e.g. Susquehanna" maxlength="80"></label>
        ${t || s.home ? "" : '<p class="note">Next you\'ll name its first game.</p>'}
        ${btns(t ? "Save" : "Create", 'type="submit"')}
        ${t && !s.confirm ? '<button class="menu-del" type="button" data-act="tour-del">Remove this tournament</button>' : ""}
        ${t && s.confirm ? `<div class="remove-choices">${removeChoices(t, "tour-del", "btn ")}</div>` : ""}
      </form>`;
    } else if (s.type === "player") {
      const p = P(s.id);
      if (!p) { ui.sheet = null; root.innerHTML = ""; return; }
      title = esc(label(p)); sub = p.name !== label(p) ? esc(p.name) : "";
      body = `<div class="form">
        <label>Nickname (shown on the board)<input class="line-in" id="pk-${p.id}" data-act="p-nick" data-id="${p.id}" value="${esc(p.nick)}" placeholder="${esc(p.name.split(" ")[0])}" maxlength="30"></label>
        <label>Full name<input class="line-in" id="pn-${p.id}" data-act="p-name" data-id="${p.id}" value="${esc(p.name)}" maxlength="60"></label>
        <div class="fill-pair"><span>Matching</span><div class="seg inset wide" role="group" aria-label="Matching"><button data-act="pe-g" data-id="${p.id}" data-v="W" aria-pressed="${p.gender === "W"}"><span class="cw">●</span> Women-matching</button><button data-act="pe-g" data-id="${p.id}" data-v="M" aria-pressed="${p.gender === "M"}"><span style="color:var(--m-light)">●</span> Men-matching</button></div></div>
        <div class="fill-pair"><span>Badge</span><div class="seg inset wide" role="group" aria-label="Badge">${[["", "None"], ["C", "Captain"], ["P", "President"]].map(([v, t]) => `<button data-act="pe-badge" data-id="${p.id}" data-v="${v}" aria-pressed="${(p.badge || "") === v}">${t}</button>`).join("")}</div></div>
        <div class="fill-pair"><span>Playing</span><div class="seg inset wide" role="group" aria-label="Playing"><button data-act="pe-active" data-id="${p.id}" data-v="1" aria-pressed="${!!p.active}">Active</button><button data-act="pe-active" data-id="${p.id}" data-v="0" aria-pressed="${!p.active}">Out</button></div>
          <p class="fill-pair-note">Out hides them from the player picker and the line maker without deleting their stats.</p></div>
        ${btns("Done", 'data-act="close"', false)}
        <button class="menu-del${s.confirm ? " armed" : ""}" data-act="pe-delete" data-id="${p.id}">${s.confirm ? "Tap again to remove " + esc(label(p)) : "Remove from the roster · tap twice"}</button>
      </div>`;
    } else if (s.type === "pod") {
      const x = podsOf().find(y => y.id === s.id);
      if (!x) { ui.sheet = null; root.innerHTML = ""; return; }
      title = esc(x.name); sub = countText(podCounts(x.ids));
      body = `<div class="form">
        <label>Name<input class="line-in" id="podname-${x.id}" data-act="pod-name" data-id="${x.id}" value="${esc(x.name)}" maxlength="30"></label>
        <div class="fill-pair"><span>Players</span><div class="pod-members pchips">${x.ids.map((id, i) => { const p = P(id); return p ? `<span class="pchip"><i class="dot ${p.gender || ""}"></i>${esc(label(p))}<button data-act="pod-remove" data-id="${x.id}" data-i="${i}" aria-label="Take ${esc(label(p))} out of ${esc(x.name)}">×</button></span>` : ""; }).join("")}<button class="pchip" data-act="pod-add" data-id="${x.id}" style="border-style:dashed;color:var(--teal)">+ Add</button></div></div>
        ${btns("Done", 'data-act="close"', false)}
        <button class="menu-del${ui.podConfirm === x.id ? " armed" : ""}" data-act="pod-delete" data-id="${x.id}">${ui.podConfirm === x.id ? "Tap again to delete " + esc(x.name) : "Delete pod · tap twice"}</button>
      </div>`;
    }
    root.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${title.replace(/<[^>]+>/g, "")}">
      <div class="sheet-head"><div class="t"><h3>${title}</h3>${sub ? `<span class="sub">${sub}</span>` : ""}</div><button class="close-btn" data-act="close" aria-label="Close">×</button></div>
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
    return `<div class="above">
      <div><span class="eyebrow">Edit lines</span><h1 class="page-title">${esc(g.name)}</h1><span class="page-sub">Tap lines to select them for deleting. Press and hold a line, then drag it to move it.</span></div>
      <div class="egrid" id="egrid">${tiles}</div></div>`;
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
    if (ui.tab === "tour" || ui.tab === "home") { ui.tab = "points"; store.set("tab", "points"); ui.swipe = null; }
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
    if (a === "add-point") { closeSheet(); const pts = gamePoints(ui.gameId); newPointAfter(null, false); if (swipeMode()) showLine(pts.length); else setTimeout(() => { const cards = document.querySelectorAll(".point"); cards[cards.length - 1]?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 50); return; }
    if (a === "role") { const k = +el.dataset.k; patchPoint(id, pt => { const s = pt.lineup[k]; if (s) { const cur = s.r === "P" ? "C" : (s.r || ""); s.r = ROLES[(ROLES.indexOf(cur) + 1) % ROLES.length]; } }); return; }
    if (a === "od") { const k = +el.dataset.k; patchPoint(id, pt => { const o = pt.outcomes[k]; o.start_on = o.start_on === el.dataset.v ? "" : el.dataset.v; }); return; }
    if (a === "go-line") { const cur = (ui.swipe && ui.swipe.i) || 0; showLine(el.dataset.dir ? cur + +el.dataset.dir : +el.dataset.i); if (!el.dataset.dir) window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (a === "games") { openSheet({ type: "games" }); return; }
    if (a === "pick-game") { closeSheet(); ui.swipe = null; ui.editLines = null; ui.undoDel = null; ui.gameId = id; store.set("game", id); render(); window.scrollTo(0, 0); return; }
    if (a === "pt-open") { const k = id + ":" + el.dataset.k; ui.openPt = ui.openPt === k ? null : k; render(); return; }
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
    if (a === "pod-new") { const x = { id: uid(), name: nextPodName(), ids: [] }; savePods(n => { n.push(x); }); openSheet({ type: "pick", pod: x.id }); return; }
    if (a === "pod-add") { openSheet({ type: "pick", pod: id }); return; }
    if (a === "pod-remove") { const i = +el.dataset.i; savePods(n => { const x = n.find(y => y.id === id); if (x) x.ids.splice(i, 1); }); return; }
    if (a === "pod-edit") { ui.podConfirm = null; openSheet({ type: "pod", id }); return; }
    if (a === "pod-delete") { if (ui.podConfirm !== id) { ui.podConfirm = id; renderSheet(); return; } ui.podConfirm = null; closeSheet(); savePods(n => { const i = n.findIndex(y => y.id === id); if (i >= 0) n.splice(i, 1); }); return; }
    if (a === "podl-toggle") { const s = ui.sheet; s.sel = s.sel.includes(id) ? s.sel.filter(x => x !== id) : [...s.sel, id]; renderSheet(); return; }
    if (a === "podl-go") {
      const s = ui.sheet, chosen = podsOf().filter(x => s.sel.includes(x.id)), hz = new Set(zoneOf().handlers || []), keep = s.keep !== false;
      closeSheet();
      patchPoint(s.pointId, pt => {
        const line = keep ? (pt.lineup || []).slice() : [];
        chosen.forEach(x => x.ids.forEach(pid => { if (P(pid) && line.length < SLOTS && !line.some(q => q.p === pid)) line.push({ p: pid, r: hz.has(pid) ? "H" : "C" }); }));
        pt.lineup = line;
      });
      toast(chosen.map(x => x.name).join(" + ") + " on the line"); return;
    }
    if (a === "fill-late") { ui.lateMode = el.dataset.v; store.set("lateMode", ui.lateMode); renderSheet(); return; }
    if (a === "tour-del") {
      if (!el.dataset.v) { ui.sheet.confirm = true; renderSheet(); return; }
      const tid = ui.sheet.id; closeSheet(); removeTour(tid, el.dataset.v === "all"); return;
    }
    if (a === "home-tour") { openTour(id); return; }
    if (a === "tour-add-game") { openSheet({ type: "game-form", tour: id }); return; }
    if (a === "tour-stats") { const gs = S.games.filter(g => g.tournament_id === id); if (gs.length) { ui.gameId = gs[gs.length - 1].id; store.set("game", ui.gameId); } ui.stats.scope = "tour"; ui.tab = "stats"; store.set("tab", "stats"); render(); window.scrollTo(0, 0); return; }
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
      if (s.pod) { const k = s.pod; savePods(n => { const x = n.find(y => y.id === k); if (x && !x.ids.includes(pid)) x.ids.push(pid); }); renderSheet(); return; }
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
      if (a === "pm-pods") openSheet({ type: "pods-line", pointId: pid, sel: [], keep: true });
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
    if (a === "p-edit") { openSheet({ type: "player", id }); return; }
    if (a === "pe-g") { const p = P(id); if (p && p.gender !== el.dataset.v) savePlayer({ ...p, gender: el.dataset.v }); return; }
    if (a === "pe-badge") { const p = P(id); if (p && (p.badge || "") !== el.dataset.v) savePlayer({ ...p, badge: el.dataset.v }); return; }
    if (a === "pe-active") { const p = P(id), v = el.dataset.v === "1"; if (p && !!p.active !== v) savePlayer({ ...p, active: v }); return; }
    if (a === "pe-delete") {
      if (!ui.sheet.confirm) { ui.sheet.confirm = true; renderSheet(); return; }
      closeSheet(); save("app_delete_player", { p_id: id }, () => removeLocal("players", id)); return;
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
    if (a === "pod-name") { const v = el.value.trim().slice(0, 30); const x = podsOf().find(y => y.id === id); if (!x || !v || v === x.name) { if (x) el.value = x.name; return; } savePods(n => { const y = n.find(z => z.id === id); if (y) y.name = v; }); return; }
    if (el.id === "podKeep") { ui.sheet.keep = el.checked; renderSheet(); return; }
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
      const full = $("#addName").value.trim().replace(/\s+/g, " "), nickIn = $("#addNick").value.trim().replace(/\s+/g, " ");
      if (!full && !nickIn) { toast("Type a nickname or a name first"); $("#addNick")?.focus(); return; }
      const name = full || nickIn, nick = nickIn || name.split(" ")[0];
      if (S.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast(name + " is already on the roster"); return; }
      ui.addName = ""; ui.addNick = "";
      savePlayer({ id: uid(), name, nick, gender: ui.addG === "W" ? "W" : "M", active: true, created_at: new Date().toISOString() });
      toast("Added " + nick); setTimeout(() => $("#addNick")?.focus(), 0);
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
    const sea = `<div class="gate-sea"><div class="wave"></div><div class="gate-foot">Deep Blue Ultimate · Franklin &amp; Marshall</div></div>`;
    if (!TOKEN) {
      $("#app").innerHTML = `<div class="gate"><div class="gate-card"><span class="gate-logo">${LOGO}</span><h1>Deep Blue</h1><p>This board needs the team link. Ask a captain to send it to you.</p></div>${sea}</div>`;
      return;
    }
    $("#app").innerHTML = `<div class="gate"><form class="gate-card" id="gateForm">
      <span class="gate-logo">${LOGO}</span>
      <h1>Deep Blue <span class="test-tag">TEST</span></h1>
      <p>Test board for the line maker. Changes here don't touch the real board. Enter the test passcode.</p>
      <label for="gateCode">Team passcode<input id="gateCode" type="password" autocomplete="current-password" autofocus></label>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <button class="btn primary" id="gateBtn" type="submit">Open the board</button>
    </form>${sea}</div>`;
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
