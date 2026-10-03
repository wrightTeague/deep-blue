/* Deep Blue Board: shared point planner + stats.
   Data lives in Supabase. The browser never touches tables directly; every read and
   write goes through app_* functions that check the team link token and passcode. */
(function () {
  "use strict";

  const SUPABASE_URL = "https://hqlvhzrafntwqsktxljl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_RxdiFg2zzl4aYnH92hQ6-g_ZACvuXLc";
  const APP_VERSION = "2026.10.03.4"; // keep in sync with version.json and the ?v= in index.html
  const SLOTS = 7;
  const ROLES = ["", "H", "C"];
  const ROLE_NAME = { H: "Handle", C: "Cut" };
  const BADGES = ["", "C", "P"];
  const BADGE_NAME = { C: "Captain", P: "President" };
  const ZONES = [["deep", "Deep deep"], ["cup", "Cup"], ["short", "Short deep"]];

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
  let S = { team: null, tournaments: [], players: [], games: [], points: [] };
  const ui = { tab: store.get("tab", "points"), gameId: store.get("game", null), stats: { scope: "game", sort: "pts" }, sheet: null, sync: "connecting", rosterFilter: "" };
  let pending = 0, refreshQueued = false;
  // Copied line players, kept on this device so they can be pasted into any game.
  ui.clip = store.get("clip", null);   // { lineup:[{p,r}], from:"Line 3 · vs Susquehanna" }
  ui.undo = null;                      // { id, lineup } for the last paste
  ui.pickSort = store.get("pickSort", "rest"); // player picker order for lines: "rest" (sat longest first) or "az"

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
      S = { team: d.team, tournaments: d.tournaments || [], players: d.players || [], games: d.games || [], points: d.points || [] };
      store.set("cache", S);
      if (!game()) ui.gameId = S.games.length ? S.games[S.games.length - 1].id : null;
      if (first) connect();
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

  const savePoint = pt => save("app_save_point", { x: pt }, () => upsertLocal("points", pt));
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
  // Points each player has sat going into line idx: the points played by the lines since the
  // last line they were on. sat(id) is null when they haven't been on a line yet this game.
  function restBefore(lines, idx) {
    const lastEnd = new Map(); let elapsed = 0;
    for (let i = 0; i < idx; i++) { elapsed += playsOf(lines[i]); (lines[i].lineup || []).forEach(s => lastEnd.set(s.p, elapsed)); }
    return { elapsed, sat: id => lastEnd.has(id) ? elapsed - lastEnd.get(id) : null };
  }

  // ---------- render: shell ----------
  const TABS = [["points", "Points"], ["zone", "Zone"], ["stats", "Stats"], ["roster", "Roster"]];

  function render() {
    if (!S.team) return;
    const app = $("#app");
    const active = document.activeElement;
    const keep = active && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const tabsHTML = TABS.map(([k, t]) => `<button data-act="tab" data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ""}>${t}</button>`).join("");
    const opt = (g, withDate) => `<option value="${g.id}" ${g.id === ui.gameId ? "selected" : ""}>${esc(g.name)}${withDate && g.game_date ? " · " + fmtDate(g.game_date) : ""}</option>`;
    const loose = S.games.filter(g => !tourOf(g));
    const gameOpts = tours().map(t => { const gs = S.games.filter(g => g.tournament_id === t.id); return gs.length ? `<optgroup label="${esc(t.name)}">${gs.map(g => opt(g, false)).join("")}</optgroup>` : ""; }).join("")
      + (loose.length ? (tours().length ? `<optgroup label="Other games">${loose.map(g => opt(g, true)).join("")}</optgroup>` : loose.map(g => opt(g, true)).join("")) : "");
    app.innerHTML = `
      <header class="top"><div class="top-in">
        <p class="brand">Deep Blue</p>
        <div class="game-pick">
          ${S.games.length ? `<select id="gameSel" aria-label="Game">${gameOpts}</select>` : `<span class="muted">No games yet</span>`}
          <button class="icon-btn" data-act="game-menu" aria-label="Game options">⋯</button>
        </div>
        <nav class="tabs" aria-label="Sections">${tabsHTML}</nav>
        <span class="sync ${ui.sync}" id="sync"><i></i><span>${ui.sync === "live" ? "Live" : ui.sync === "offline" ? "Offline" : "Connecting"}</span></span>
      </div></header>
      <main id="main">${ui.tab === "zone" ? renderZone() : ui.tab === "stats" ? renderStats() : ui.tab === "roster" ? renderRoster() : renderPoints()}</main>
      ${ui.clip && ui.tab === "points" ? clipBar() : ""}
      <nav class="bottom-nav" aria-label="Sections">${tabsHTML}</nav>`;
    renderSheet();
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch (e) {} } }
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
  function renderPoints() {
    const g = game(); if (!g) return noGame();
    const lines = gamePoints(g.id), st = computeStats(lines).team;
    let next = 1;
    const cards = lines.map((pt, i) => { const from = next; next += playsOf(pt); return lineCard(pt, i, from, restBefore(lines, i)); }).join("");
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
      <div class="points">${cards}<div class="add-wrap"><button class="add-point" data-act="add-point">+ Add line</button>${ui.clip ? '<button class="add-point paste" data-act="paste-new">+ Paste as new line</button>' : ""}</div></div>
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

  function lineCard(pt, i, from, rest) {
    const line = pt.lineup || [], o = outs(pt), n = o.length, to = from + n - 1;
    let w = 0, m = 0; line.forEach(s => { const p = P(s.p); if (p?.gender === "W") w++; else if (p?.gender === "M") m++; });
    const goals = new Map(), assists = new Map();
    o.forEach(x => { if (x.result === "us") { if (x.scorer) goals.set(x.scorer, (goals.get(x.scorer) || 0) + 1); if (x.assist && x.assist !== "none") assists.set(x.assist, (assists.get(x.assist) || 0) + 1); } });
    const slots = [];
    for (let k = 0; k < SLOTS; k++) {
      const s = line[k];
      if (s) {
        const p = P(s.p), r = s.r === "P" ? "C" : (s.r || "");
        const gN = goals.get(s.p) || 0, aN = assists.get(s.p) || 0;
        const ball = (gN || aN) ? `<span class="ball">${[gN ? (gN > 1 ? gN + " " : "") + "G" : "", aN ? (aN > 1 ? aN + " " : "") + "A" : ""].filter(Boolean).join(" · ")}</span>` : "";
        const sat = rest && rest.elapsed ? rest.sat(s.p) : undefined;
        const restTag = sat === undefined ? "" : sat === null ? `<span class="rest">1st shift</span>` : sat === 0 ? `<span class="rest b2b">back to back</span>` : `<span class="rest">sat ${sat}</span>`;
        slots.push(`<li class="slot">
          <button class="role" data-r="${r}" data-act="role" data-id="${pt.id}" data-k="${k}" aria-label="Role: ${ROLE_NAME[r] || "none"}. Tap to change">${r || "–"}</button>
          <button class="who" data-act="pick-slot" data-id="${pt.id}" data-k="${k}"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span><span class="nm">${esc(label(p))}${badge(p)}</span>${ball}${restTag}</button>
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
      return `<div class="pt-row">
        <div class="pt-line">
          <span class="pt-n">Pt ${from + k}</span>
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
    return `<article class="point ${done ? "done" : ""}">
      <div class="point-head">
        <h3>Line ${i + 1}</h3>
        <span class="tag">${n === 1 ? "Pt " + from : "Pts " + from + "–" + to}</span>
        ${ui.clip ? `<button class="btn sm primary" data-act="paste-line" data-id="${pt.id}">Paste</button>` : ""}
        <button class="icon-btn" data-act="point-menu" data-id="${pt.id}" aria-label="Line ${i + 1} options">⋯</button>
      </div>
      <ul class="slots">${slots.join("")}</ul>
      <div class="point-foot">
        <span class="counts"><span>${line.length}/${SLOTS}</span><span class="cw">${w} W</span><span class="cm">${m} M</span></span>
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

  // ---------- render: zone ----------
  function renderZone() {
    const g = game(); if (!g) return noGame();
    const z = g.zone || {};
    const cols = ZONES.map(([k, t]) => {
      const ids = z[k] || [];
      const chips = ids.map((id, i) => { const p = P(id); return `<div class="chip"><span class="mag ${p?.gender || "U"}">${p?.gender || "?"}</span><span class="nm">${esc(label(p))}${badge(p)}</span><button class="icon-btn" data-act="zone-remove" data-z="${k}" data-i="${i}" aria-label="Remove ${esc(label(p))} from ${t}">×</button></div>`; }).join("");
      return `<section class="zone-col"><h3>${t}</h3>${chips || '<p class="empty-note">Nobody yet.</p>'}<button class="btn sm" data-act="zone-add" data-z="${k}" style="align-self:flex-start">+ Add</button></section>`;
    }).join("");
    return `<h2 class="sec">Zone spots</h2><p class="muted" style="margin:8px 0 0">For ${esc(g.name)}.</p><div class="zone-grid">${cols}</div>`;
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
        <input class="line-in" id="addName" placeholder="Add a player (full name)" maxlength="60" style="flex:1;min-width:180px">
        <input class="line-in" id="addNick" placeholder="Nickname" maxlength="30" style="width:110px">
        <div class="seg" role="group" aria-label="Matchup"><button type="button" data-act="add-g" data-v="W" aria-pressed="${ui.addG === "W"}">W</button><button type="button" data-act="add-g" data-v="M" aria-pressed="${ui.addG !== "W"}">M</button></div>
        <button class="btn primary sm" type="submit">Add</button>
      </form>
      <input class="line-in" id="rosterFilter" placeholder="Search roster" value="${esc(ui.rosterFilter)}" style="width:100%;max-width:340px">
      <p class="muted" style="font-size:14px;margin:8px 0 0">The nickname is what shows on line cards. Tap the dot to mark a captain (C) or president (P). "Out" hides someone from the player picker without deleting their stats.</p>
      <div class="roster-cols">${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}</div>
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
  function closeSheet() { ui.sheet = null; renderSheet(); }

  function renderSheet() {
    const root = $("#sheet-root"), s = ui.sheet;
    if (!s) { root.innerHTML = ""; return; }
    let title = "", tools = "", body = "";
    if (s.type === "pick") {
      const g = game(), pts = g ? gamePoints(g.id) : [];
      const planned = plannedPoints(pts);
      let taken = new Set();
      if (s.pointId) { const pt = S.points.find(x => x.id === s.pointId); (pt?.lineup || []).forEach(x => taken.add(x.p)); }
      if (s.zone) taken = new Set((g?.zone?.[s.zone]) || []);
      const q = (s.q || "").toLowerCase(), f = s.f || "";
      // Picking for a line (not a zone) after the first one: show how long each person has sat.
      const lineIdx = s.pointId && !s.zone ? pts.findIndex(x => x.id === s.pointId) : -1;
      const rest = lineIdx > 0 ? restBefore(pts, lineIdx) : null;
      const byRest = !!rest && ui.pickSort !== "az";
      const satKey = p => { const v = rest.sat(p.id); return v === null ? Infinity : v; };
      let list = sortPlayers(activePlayers()).filter(p => (!f || p.gender === f) && (!q || p.name.toLowerCase().includes(q) || (p.nick || "").toLowerCase().includes(q)));
      if (byRest) list = list.sort((a, b) => satKey(b) - satKey(a));
      const restText = p => { if (!rest) return ""; const v = rest.sat(p.id); return v === null ? `<b class="rest first">not in yet</b>` : v === 0 ? `<span class="rest b2b">just played</span>` : `sat ${v}`; };
      const meta = p => taken.has(p.id) ? "on it" : [restText(p), (planned.get(p.id) || 0) + (rest ? " planned" : " pts planned")].filter(Boolean).join(" · ");
      const item = p => `<li><button data-act="pick" data-p="${p.id}" ${taken.has(p.id) ? "disabled" : ""}><span class="mag ${p.gender || "U"}">${p.gender || "?"}</span><span class="nm">${esc(p.name)}${badge(p)}</span><span class="meta">${meta(p)}</span></button></li>`;
      const sec = (gnd, t) => { const items = list.filter(p => (p.gender || "") === gnd).map(item).join(""); return items ? `<li class="pick-group">${t}</li>${items}` : ""; };
      title = s.zone ? "Add to " + (ZONES.find(z => z[0] === s.zone) || [0, ""])[1] : s.current ? "Swap " + esc(label(P(s.current))) : "Add player";
      tools = `<input class="line-in" id="pickQ" placeholder="Search" value="${esc(s.q || "")}" autofocus autocomplete="off">
        <div class="seg" role="group" aria-label="Filter"><button data-act="pick-f" data-v="" aria-pressed="${!f}">All</button><button data-act="pick-f" data-v="W" aria-pressed="${f === "W"}">W</button><button data-act="pick-f" data-v="M" aria-pressed="${f === "M"}">M</button></div>
        ${rest ? `<div class="seg" role="group" aria-label="Sort"><button data-act="pick-sort" data-v="rest" aria-pressed="${byRest}">Sat longest</button><button data-act="pick-sort" data-v="az" aria-pressed="${!byRest}">A–Z</button></div>` : ""}`;
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
        ${t ? `<button data-act="copy-game">Next game in ${esc(t.name)} (copy these lines)</button>
        <button data-act="new-game-tour">New empty game in ${esc(t.name)}</button>` : ""}
        <button data-act="new-game">New game</button>
        <button data-act="new-tour">New tournament</button>
        ${g ? `<button data-act="edit-game">Edit game (name, date, tournament)</button>
        ${t ? "" : '<button data-act="copy-game">New game copying these lines</button>'}
        <button class="danger" data-act="delete-game">${s.confirm === "game" ? "Tap again to delete " + esc(g.name) + " and its lines" : "Delete game"}</button>` : ""}
        ${t ? `<button data-act="edit-tour">Rename ${esc(t.name)}</button>
        <button class="danger" data-act="delete-tour">${s.confirm === "tour" ? "Tap again: remove the tournament (its games are kept)" : "Remove tournament folder"}</button>` : ""}
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
    } else if (s.type === "tour-form") {
      const t = s.id ? tours().find(x => x.id === s.id) : null;
      title = t ? "Rename tournament" : "New tournament";
      body = `<form class="form" id="tourForm">
        <label>Name<input class="line-in" id="tName" value="${esc(t ? t.name : "")}" placeholder="e.g. Haverford Hat" maxlength="80" autofocus required></label>
        <label>Date<input class="line-in" id="tDate" type="date" value="${esc(t?.start_date || "")}"></label>
        ${t ? "" : '<p class="muted" style="margin:0;font-size:14px">Next you\'ll name its first game.</p>'}
        <div class="row"><button class="btn primary" type="submit">${t ? "Save" : "Create"}</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div>
      </form>`;
    }
    root.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${title.replace(/<[^>]+>/g, "")}">
      <div class="sheet-head"><h3>${title}</h3><button class="icon-btn" data-act="close" aria-label="Close">×</button></div>
      ${tools ? `<div class="sheet-tools">${tools}</div>` : ""}
      <div class="sheet-body">${body}</div></div></div>`;
  }

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
  function patchPoint(id, fn) {
    const pt = S.points.find(x => x.id === id); if (!pt) return;
    const next = JSON.parse(JSON.stringify(pt));
    next.outcomes = outs(next); fn(next);
    next.plays = playsOf(next);
    const ids = new Set((next.lineup || []).map(x => x.p));
    next.outcomes = outs(next).map(o => {
      if (o.result !== "us") { o.scorer = null; o.assist = null; }
      if (o.scorer && !ids.has(o.scorer)) o.scorer = null;
      if (o.assist && o.assist !== "none" && !ids.has(o.assist)) o.assist = null;
      return o;
    });
    savePoint(next);
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
      if (ui.sheet.confirm !== "tour") { ui.sheet.confirm = "tour"; renderSheet(); return; }
      const tid = game()?.tournament_id; closeSheet();
      save("app_delete_tournament", { p_id: tid }, () => { S.tournaments = tours().filter(t => t.id !== tid); S.games.forEach(g => { if (g.tournament_id === tid) g.tournament_id = null; }); });
      return;
    }
    if (a === "edit-game") { openSheet({ type: "game-form", id: ui.gameId }); return; }
    if (a === "copy-game") { openSheet({ type: "game-form", copyFrom: ui.gameId }); return; }
    if (a === "delete-game") {
      if (ui.sheet.confirm !== "game") { ui.sheet.confirm = "game"; renderSheet(); return; }
      const gid = ui.gameId; closeSheet();
      save("app_delete_game", { p_id: gid }, () => { removeLocal("games", gid); S.points = S.points.filter(x => x.game_id !== gid); ui.gameId = S.games.length ? S.games[S.games.length - 1].id : null; store.set("game", ui.gameId); });
      return;
    }
    if (a === "add-point") { const pts = gamePoints(ui.gameId); newPointAfter(null, false); setTimeout(() => { const cards = document.querySelectorAll(".point"); cards[cards.length - 1]?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 50); void pts; return; }
    if (a === "role") { const k = +el.dataset.k; patchPoint(id, pt => { const s = pt.lineup[k]; if (s) { const cur = s.r === "P" ? "C" : (s.r || ""); s.r = ROLES[(ROLES.indexOf(cur) + 1) % ROLES.length]; } }); return; }
    if (a === "od") { const k = +el.dataset.k; patchPoint(id, pt => { const o = pt.outcomes[k]; o.start_on = o.start_on === el.dataset.v ? "" : el.dataset.v; }); return; }
    if (a === "result") {
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
      return;
    }
    if (a === "set-goal") { const k = +el.dataset.k, v = el.dataset.p; patchPoint(id, pt => { const o = pt.outcomes[k]; o.scorer = v; if (o.assist === v) o.assist = null; }); return; }
    if (a === "set-assist") { const k = +el.dataset.k, v = el.dataset.p; patchPoint(id, pt => { pt.outcomes[k].assist = v; }); return; }
    if (a === "ga-change") { const k = +el.dataset.k; patchPoint(id, pt => { pt.outcomes[k].scorer = null; pt.outcomes[k].assist = null; }); return; }
    if (a === "pick-slot") { const pt = S.points.find(x => x.id === id), k = +el.dataset.k; openSheet({ type: "pick", pointId: id, k, current: pt?.lineup?.[k]?.p || null }); return; }
    if (a === "pick-f") { ui.sheet.f = el.dataset.v; renderSheet(); return; }
    if (a === "pick-sort") { ui.pickSort = el.dataset.v; store.set("pickSort", ui.pickSort); renderSheet(); return; }
    if (a === "pick") {
      const pid = el.dataset.p, s = ui.sheet;
      if (s.zone) { const z = s.zone; patchGame(g => { g.zone = g.zone || {}; g.zone[z] = [...(g.zone[z] || []), pid]; }); renderSheet(); return; }
      patchPoint(s.pointId, pt => { pt.lineup = pt.lineup || []; if (s.current) { const slot = pt.lineup.find(x => x.p === s.current); if (slot) slot.p = pid; } else if (pt.lineup.length < SLOTS) pt.lineup.push({ p: pid, r: "" }); });
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
    if (a === "zone-remove") { const z = el.dataset.z, i = +el.dataset.i; patchGame(g => { g.zone[z].splice(i, 1); }); return; }
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
    if (a === "logout") { store.del("code"); store.del("cache"); CODE = ""; location.reload(); return; }
  });

  document.addEventListener("change", e => {
    const el = e.target;
    if (el.id === "gameSel") { ui.gameId = el.value; store.set("game", ui.gameId); render(); return; }
    const a = el.dataset.act, id = el.dataset.id;
    if (a === "p-name") { const p = P(id), v = el.value.trim(); if (v && v !== p.name) savePlayer({ ...p, name: v }); else el.value = p.name; return; }
    if (a === "p-nick") { const p = P(id), v = el.value.trim(); if (v !== p.nick) savePlayer({ ...p, nick: v }); return; }
  });

  document.addEventListener("input", e => {
    if (e.target.id === "pickQ") { ui.sheet.q = e.target.value; const pos = e.target.selectionStart; renderSheet(); const q = $("#pickQ"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) {} }
    if (e.target.id === "rosterFilter") { ui.rosterFilter = e.target.value; render(); }
  });

  document.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet) closeSheet(); });

  document.addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "addForm") {
      const name = $("#addName").value.trim().replace(/\s+/g, " "); if (!name) return;
      if (S.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast(name + " is already on the roster"); return; }
      const nick = $("#addNick").value.trim() || name.split(" ")[0];
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
      const name = $("#tName").value.trim(), date = $("#tDate").value; if (!name) return;
      const s = ui.sheet;
      if (s.id) { const t = tours().find(x => x.id === s.id); closeSheet(); save("app_save_tournament", { x: { ...t, name, start_date: date || null } }, () => Object.assign(t, { name, start_date: date || null })); }
      else {
        const t = { id: uid(), name, start_date: date || null };
        save("app_save_tournament", { x: t }, () => { S.tournaments = [...tours(), t]; });
        openSheet({ type: "game-form", tour: t.id });
      }
      return;
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
      if (v && v !== APP_VERSION && pending === 0) {
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
