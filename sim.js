/* Deep Blue playing-time simulator. Its own page, sim.html, linked quietly from the bottom of
   Roster. The same file runs on both boards; test/sim.html marks itself data-board="test".
   It runs Fill lines (DBLines.simDay in lines.js) over one whole tournament day under two
   setups, A and B, and compares the points each person would play.
   Read-only: it loads the board with the passcode already saved on this phone and never saves
   anything to the team. It only writes this phone's own settings (its own, and Fill lines' when
   you tap "Use B in Fill lines"). The Fill lines inputs below mirror autoFill in app.js; keep the
   two in step. */
(function () {
  "use strict";

  const SUPABASE_URL = "https://hqlvhzrafntwqsktxljl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_RxdiFg2zzl4aYnH92hQ6-g_ZACvuXLc";
  const TEST = document.documentElement.dataset.board === "test";
  const TAG = TEST ? ' <span class="test-tag">TEST</span>' : "", BOARD = TEST ? "test board" : "board";
  const BADGE_NAME = { C: "Captain", P: "President" };
  const ZONES = ["handlers", "deep", "short"];
  const MAX_GAMES = 8, PPG_MIN = 5, PPG_MAX = 25;

  const timedFetch = (url, opts = {}) => {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 15000);
    if (opts.signal) opts.signal.addEventListener("abort", () => c.abort());
    return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
  };
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
  const TOKEN = (new URLSearchParams(location.search).get("t") || "").trim();

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const key = k => "deepblue:" + TOKEN + ":" + k;   // same keys as the board, so it shares the passcode and Fill lines settings
  const store = {
    has(k) { try { return localStorage.getItem(key(k)) != null; } catch (e) { return false; } },
    get(k, d) { try { const v = localStorage.getItem(key(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) {} },
  };
  function toast(msg, ms) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms || 3200);
  }
  const CODE = store.get("code", ""), OWNER = store.get("owner", "");
  const LOGO = `<svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><path d="M3 6.5 C 6 2.5, 10 2.5, 13 6.5 S 20 10.5, 23 6.5 S 27 3.5, 28 4.5" fill="none" stroke="#0b2540" stroke-width="2.4" stroke-linecap="round"/><path d="M3 13.5 C 6 9.5, 10 9.5, 13 13.5 S 20 17.5, 23 13.5" fill="none" stroke="#1f6fd1" stroke-width="2.4" stroke-linecap="round"/></svg>`;

  // ---------- data (the same shape as the board's S) ----------
  let S = null, byId = new Map(), owner = null, offline = false, problem = "", dataVer = 0;
  const P = id => byId.get(id);
  const label = p => p ? (p.nick || p.name) : "?";
  const badge = p => p && p.badge ? `<span class="badge" title="${BADGE_NAME[p.badge]}" aria-label="${BADGE_NAME[p.badge]}">${p.badge}</span>` : "";
  const isLead = p => !!p && (p.badge === "C" || p.badge === "P");
  const tours = () => S.tournaments || [];
  const gamePoints = gid => S.points.filter(x => x.game_id === gid).sort((a, b) => a.pos - b.pos);
  const activePlayers = () => S.players.filter(p => p.active);
  const sortPlayers = list => list.slice().sort((a, b) => (a.gender === b.gender ? 0 : a.gender === "W" ? -1 : b.gender === "W" ? 1 : 0) || label(a).localeCompare(label(b)));
  const clean = s => { (s.players || []).forEach(p => { if (p.gender !== "W" && p.gender !== "M") p.gender = ""; if (!BADGE_NAME[p.badge]) p.badge = ""; }); return s; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const people = n => (n === 1 ? "1 person" : n + " people");
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const fmtDay = d => { const [y, m, day] = String(d || "").split("-").map(Number); return y ? new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ""; };
  const played = l => (Array.isArray(l.outcomes) ? l.outcomes : []).slice(0, DBLines.playsOf(l)).some(o => o && o.result);
  const asc = (a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0);

  function setData(d) {
    S = clean({ team: d.team, tournaments: d.tournaments || [], players: d.players || [], games: d.games || [], points: d.points || [], practices: d.practices || [] });
    byId = new Map(S.players.map(p => [p.id, p]));
    dataVer++;
  }

  // Attendance, as app.js: practices after the last tournament before the date count, and the
  // nudge is +1 line sat for someone at every practice vs none, centred on the team average.
  const practices = () => (S.practices || []).slice().sort((a, b) => (a.practice_date < b.practice_date ? -1 : a.practice_date > b.practice_date ? 1 : 0));
  function attendanceFor(date, tourId) {
    date = date || todayISO();
    const since = tours().filter(t => t.start_date && t.start_date < date && t.id !== tourId).sort(asc).pop() || null;
    const list = practices().filter(x => x.practice_date <= date && (!since || x.practice_date > since.start_date));
    const count = new Map();
    list.forEach(x => (x.attended || []).forEach(id => count.set(id, (count.get(id) || 0) + 1)));
    return { since, list, n: list.length, count };
  }
  function attendancePriority(att) {
    if (!att.n) return {};
    const ps = activePlayers().filter(p => !isLead(p)); if (!ps.length) return {};
    const avg = ps.reduce((a, p) => a + (att.count.get(p.id) || 0), 0) / ps.length;
    return Object.fromEntries(ps.map(p => [p.id, ((att.count.get(p.id) || 0) - avg) / att.n]));
  }
  const sinceText = att => att.since ? `since ${esc(att.since.name)}${att.since.start_date ? " (" + fmtDay(att.since.start_date) + ")" : ""}` : "so far";
  const zoneSets = () => { const z = (S.team && S.team.zone) || {}; return Object.fromEntries(ZONES.map(k => [k, { main: new Set(z[k] || []), ok: new Set(z[k + "_ok"] || []) }])); };
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

  // ---------- setups A and B ----------
  function fixSetup(x) {
    x = x && typeof x === "object" ? x : {};
    const pick = (v, ok, d) => (ok.includes(v) ? v : d);
    return { plays: pick(x.plays, [1, 2, 3], 1), caps: pick(x.caps, [0, 1, 2, 3], 2), ratio: pick(x.ratio, ["34", "25", "43"], "34"), ask: x.ask !== false,
      pairing: pick(x.pairing, ["rotate", "usual", "rest"], "rotate"), useAtt: x.useAtt !== false, lateMode: pick(x.lateMode, ["start", "less"], "start") };
  }
  // This phone's Fill lines settings. "Each plays" isn't remembered there; it starts on 1.
  const fillNow = () => fixSetup({ plays: 1, caps: store.get("fillCaps", 2), ratio: store.get("fillRatio", "34"), ask: store.get("fillAsk", true),
    pairing: store.get("pairing", "rotate"), useAtt: store.get("useAtt", true), lateMode: store.get("lateMode", "start") });
  const sameFill = (a, b) => ["caps", "ratio", "ask", "pairing", "useAtt", "lateMode"].every(k => a[k] === b[k]);

  const ui = {
    tid: store.get("sim:tour", null), day: store.get("sim:day", null), ppg: store.get("sim:ppg", 11),
    view: store.get("sim:view", "B") === "A" ? "A" : "B", whoOpen: null, gridOpen: store.get("sim:grid", false) === true,
    A: fillNow(), B: store.has("sim:B") ? fixSetup(store.get("sim:B")) : fillNow(),
    who: { A: {}, B: {} },   // what-if Who's going for each setup: player id → "go" | "late" | "away"
  };
  if (!(ui.ppg >= PPG_MIN && ui.ppg <= PPG_MAX)) ui.ppg = 11;
  const saveB = () => store.set("sim:B", ui.B);
  const saveWho = () => store.set("sim:who", { tid: (currentTour() || {}).id || null, A: ui.who.A, B: ui.who.B });
  // The what-ifs come back on the next visit, for the same tournament only.
  let whoRestored = false;
  function restoreWho() {
    if (whoRestored || !S) return;
    whoRestored = true;
    const w = store.get("sim:who", null), t = currentTour();
    if (w && t && w.tid === t.id) ui.who = { A: w.A || {}, B: w.B || {} };
  }

  // ---------- tournament and day ----------
  function currentTour() {
    const list = tours(); if (!list.length) return null;
    const pick = list.find(x => x.id === ui.tid); if (pick) return pick;
    const today = todayISO(), dated = list.filter(x => x.start_date).sort(asc);
    const playingToday = S.games.find(g => g.tournament_id && g.game_date === today);
    return (playingToday && list.find(x => x.id === playingToday.tournament_id)) || dated.find(x => x.start_date >= today) || dated[dated.length - 1] || list[0];
  }
  // A day is the tournament's games with the same game date, as Fill lines counts it ("" = no date).
  function daysOf(t) {
    const ds = [];
    S.games.forEach(g => { if (g.tournament_id !== t.id) return; const d = g.game_date || ""; if (!ds.includes(d)) ds.push(d); });
    return ds.length ? ds : [""];
  }
  function currentDay(t) { const ds = daysOf(t); return ds.includes(ui.day) ? ui.day : ds.includes(todayISO()) ? todayISO() : ds[0]; }
  const dayLabel = (t, d, many) => d ? fmtDay(d) : t.start_date ? fmtDay(t.start_date) + (many ? " · games with no date" : "") : "No date";
  // The day's games in play order, padded with made-up ones (or trimmed) to the number asked for.
  // Games up to the last one with a result can't be taken off.
  function dayGames(t, d) {
    const real = S.games.filter(g => g.tournament_id === t.id && (g.game_date || "") === d).map(g => ({ id: g.id, name: g.name, lines: gamePoints(g.id) }));
    const minN = Math.max(1, real.reduce((k, g, i) => (g.lines.some(played) ? i + 1 : k), 0));
    const saved = store.get("sim:games", null), want = saved && saved.k === t.id + "|" + d ? saved.n : null;
    const n = Math.max(minN, Math.min(MAX_GAMES, want != null ? want : real.length || 4));
    const list = real.slice(0, n);
    while (list.length < n) list.push({ id: null, name: "Game " + (list.length + 1), lines: [] });
    return { list, minN, real: real.length };
  }

  // Who's going for a setup: the tournament's list with that setup's what-ifs on top.
  function whoOf(t, side) {
    const away = new Set((Array.isArray(t.away) ? t.away : []).filter(P)), late = new Set((Array.isArray(t.late) ? t.late : []).filter(P));
    const ov = ui.who[side] || {};
    const state = id => ov[id] || (away.has(id) ? "away" : late.has(id) ? "late" : "go");
    const awayIds = new Set(S.players.filter(p => state(p.id) === "away").map(p => p.id));
    const lateIds = new Set(S.players.filter(p => state(p.id) === "late").map(p => p.id));
    const going = activePlayers().filter(p => !awayIds.has(p.id));
    return { state, away: awayIds, late: lateIds, going, n: going.length, w: going.filter(p => p.gender === "W").length, m: going.filter(p => p.gender === "M").length,
      nLate: going.filter(p => lateIds.has(p.id)).length, changed: Object.keys(ov).length > 0 };
  }

  // ---------- running a setup ----------
  const memo = new Map();
  function runSide(t, d, side, games, shared) {
    const st = ui[side], who = whoOf(t, side);
    const k = JSON.stringify([dataVer, !!owner, t.id, d, games.list.length, ui.ppg, st, ui.who[side]]);
    if (memo.has(k)) return memo.get(k);
    const o = owner || { rookies: [], apart: [], together: [] };
    const res = DBLines.simDay({
      players: S.players.filter(p => !who.away.has(p.id)), games: games.list, ppg: ui.ppg, plays: st.plays,
      ratio: st.ratio === "25" ? { W: 2, M: 5 } : st.ratio === "43" ? { W: 4, M: 3 } : { W: 3, M: 4 }, five: st.ratio === "34" && st.ask,
      leaders: st.caps, pairing: st.pairing, usualPairs: shared.usualPairs, positions: shared.positions,
      rookies: new Set(o.rookies), apart: o.apart, together: o.together,
      priority: st.useAtt ? shared.priority : {}, late: who.late, lateLess: st.lateMode === "less" ? 0.5 : 0,
    });
    const out = { res, who, stats: dayStats(res, who) };
    if (memo.size > 12) memo.clear();
    memo.set(k, out);
    return out;
  }
  // Points per person, and the day's summary numbers. Averages, fewest and most leave out
  // captains and president. Back to back = two lines in a row in the same game.
  function dayStats(res, who) {
    const pts = new Map();
    res.points.forEach(x => x.ids.forEach(id => pts.set(id, (pts.get(id) || 0) + 1)));
    let b2b = 0; const gaps = [];
    res.games.forEach(g => {
      const last = new Map(); let pt = 0;
      g.lines.forEach((l, i) => {
        const start = pt; pt += l.plays;
        l.lineup.forEach(s => {
          const prev = last.get(s.p);
          if (prev) { if (prev.i === i - 1) b2b++; if (!isLead(P(s.p))) gaps.push(start - prev.end); }
          last.set(s.p, { i, end: pt });
        });
      });
    });
    const non = who.going.filter(p => !isLead(p)), v = p => pts.get(p.id) || 0;
    const avg = list => (list.length ? list.reduce((a, p) => a + v(p), 0) / list.length : null);
    const lo = non.length ? Math.min(...non.map(v)) : null, hi = non.length ? Math.max(...non.map(v)) : null;
    return {
      pts, b2b, rest: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      w: avg(non.filter(p => p.gender === "W")), m: avg(non.filter(p => p.gender === "M")), lead: avg(who.going.filter(isLead)),
      lo, hi, loWho: non.filter(p => v(p) === lo), hiWho: non.filter(p => v(p) === hi),
      fives: res.fives, short: res.short, total: res.points.length, played: res.points.filter(x => x.played).length,
    };
  }

  // ---------- render ----------
  const n1 = x => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));
  const chg = (a, b, dec) => {
    if (a == null || b == null) return '<span class="z">–</span>';
    const d = dec ? Math.round(b * 10) / 10 - Math.round(a * 10) / 10 : b - a, r = dec ? Math.round(d * 10) / 10 : Math.round(d);
    if (Math.abs(r) < (dec ? 0.05 : 0.5)) return '<span class="z">·</span>';
    return `<span class="${r > 0 ? "up" : "down"}">${r > 0 ? "+" : "−"}${dec ? Math.abs(r).toFixed(1) : Math.abs(r)}</span>`;
  };
  const whoList = list => { const names = list.map(label); return names.length > 3 ? esc(names.slice(0, 3).join(", ")) + ` +${names.length - 3}` : esc(names.join(", ")); };
  const boardHref = () => "./" + location.search;

  function setupCard(t, side, run, att) {
    const st = ui[side], who = run.who, fill = fillNow();
    const seg = (k, opts, cls) => `<div class="seg inset ${cls}" role="group">${opts.map(([v, txt]) => `<button data-act="set" data-side="${side}" data-k="${k}" data-v="${v}" aria-pressed="${String(st[k]) === String(v)}">${txt}</button>`).join("")}</div>`;
    const chip = p => { const s = who.state(p.id); return `<button class="pchip going-${s === "go" ? "going" : s}" data-act="who" data-side="${side}" data-id="${p.id}" aria-label="${esc(label(p))}: ${s === "away" ? "not going" : s === "late" ? "late" : "going"}"><i class="dot ${p.gender || ""}"></i>${esc(label(p))}${s === "late" ? "<small>late</small>" : s === "away" ? "<small>not going</small>" : ""}</button>`; };
    const grp = (g, h) => { const list = sortPlayers(activePlayers().filter(p => (p.gender || "") === g)); return list.length ? `<span class="group-title">${h}</span><div class="pchips">${list.map(chip).join("")}</div>` : ""; };
    const open = ui.whoOpen === side;
    const sub = side === "A" ? (sameFill(st, fill) ? "This phone's Fill lines settings" : "Changed here only, not in Fill lines") : "Change anything to compare";
    return `<section class="card setup setup-${side}" aria-label="Setup ${side}">
      <div class="setup-h"><span class="ab ab-${side}">${side}</span><span class="t"><b>${side === "A" ? "Fill lines now" : "Try"}</b><small>${sub}</small></span></div>
      <div class="plays-row"><span class="grow">Each new line plays</span>${seg("plays", [[1, "1"], [2, "2"], [3, "3"]], "disp")}</div>
      <div class="plays-row"><span class="grow">Captains per line</span>${seg("caps", [[0, "0"], [1, "1–2"], [2, "2"], [3, "3"]], "disp")}</div>
      <div class="fill-pair"><span>Ratio</span>${seg("ratio", [["34", "3 W · 4 M"], ["25", "2 W · 5 M"], ["43", "4 W · 3 M"]], "wide")}
        ${st.ratio === "34" ? `<label class="fill-check"><input type="checkbox" data-act="set-check" data-side="${side}" data-k="ask" ${st.ask ? "checked" : ""}><span>Every few lines, make one 2 W · 5 M so the men keep up over the day</span></label>` : ""}</div>
      ${st.caps >= 2 ? `<div class="fill-pair"><span>Captain pairs</span>${seg("pairing", [["rotate", "Rotate"], ["usual", "Mostly usual"], ["rest", "Same pairs"]], "wide")}</div>` : ""}
      <label class="fill-check"><input type="checkbox" data-act="set-check" data-side="${side}" data-k="useAtt" ${st.useAtt ? "checked" : ""}><span>Practice attendance counts<small>${att.n ? `${plural(att.n, "practice")} ${sinceText(att)}.` : `No practices checked in ${sinceText(att)}, so this does nothing yet.`}</small></span></label>
      ${who.nLate ? `<div class="fill-pair"><span>Late sign-ups (${who.nLate})</span>${seg("lateMode", [["start", "Start later"], ["less", "Start later + less time"]], "wide")}</div>` : ""}
      <div class="who">
        <button class="who-btn" data-act="who-open" data-side="${side}" aria-expanded="${open}"><span><b>${who.n} going</b> · <b class="cw">${who.w} W</b> · <b class="cm">${who.m} M</b>${who.nLate ? ` · ${who.nLate} late` : ""}${who.changed ? ' · <span class="whatif">what-if</span>' : ""}</span><span class="chev" aria-hidden="true">${open ? "▴" : "▾"}</span></button>
        ${open ? `<p class="note">Only for this simulator: tap a name to cycle going → late → not going. Who's going on the board doesn't change.</p>
          ${grp("W", "Women-matching")}${grp("M", "Men-matching")}${grp("", "Matchup not set")}
          ${who.changed ? `<button class="text-link" data-act="who-reset" data-side="${side}">Back to the board's Who's going</button>` : ""}` : ""}
      </div>
      ${side === "B" ? `<div class="setup-foot"><button class="btn sm" data-act="use-b" ${sameFill(st, fill) ? "disabled" : ""}>Use B in Fill lines</button><button class="text-link" data-act="b-from-a">Make B the same as A</button></div>`
        : sameFill(st, fill) && st.plays === 1 ? "" : `<div class="setup-foot"><button class="text-link" data-act="reset-a">Back to this phone's Fill lines settings</button></div>`}
    </section>`;
  }

  function summaryCard(A, B) {
    const a = A.stats, b = B.stats;
    const row = (name, x, y, dec, sub) => `<tr><th scope="row">${name}${sub ? `<small>${sub}</small>` : ""}</th><td>${dec ? n1(x) : x == null ? "–" : x}</td><td>${dec ? n1(y) : y == null ? "–" : y}</td><td>${chg(x, y, dec)}</td></tr>`;
    const names = (x, y) => (x.length || y.length ? `A: ${whoList(x)}${y.length ? `<br>B: ${whoList(y)}` : ""}` : "");
    const fiveRow = ui.A.ratio === "34" && ui.A.ask || ui.B.ratio === "34" && ui.B.ask || a.fives || b.fives;
    const same = JSON.stringify([ui.A, ui.who.A]) === JSON.stringify([ui.B, ui.who.B]);
    const short = [a.short ? "A" : "", b.short ? "B" : ""].filter(Boolean);
    return `<section class="card">
      <h2 class="sim-h">How the day comes out</h2>
      ${same ? '<p class="note">B is the same as A. Change something in B to see the difference.</p>' : ""}
      ${short.length ? `<p class="warn">Some lines in ${short.join(" and ")} couldn't get 7 players. Not enough women or men are going.</p>` : ""}
      <table class="sim"><thead><tr><th></th><th>A</th><th>B</th><th>Change</th></tr></thead><tbody>
        ${row("Women, average", a.w, b.w, true)}
        ${row("Men, average", a.m, b.m, true)}
        ${row("Captains &amp; president, average", a.lead, b.lead, true)}
        ${row("Fewest", a.lo, b.lo, false, names(a.loWho, b.loWho))}
        ${row("Most", a.hi, b.hi, false, names(a.hiWho, b.hiWho))}
        ${fiveRow ? row("2 W · 5 M lines", a.fives, b.fives, false) : ""}
        ${row("Back to back", a.b2b, b.b2b, false, "times someone plays 2 lines in a row")}
        ${row("Points sat between shifts", a.rest, b.rest, true, "average")}
      </tbody></table>
      <p class="legend-note">Points for the whole day. Averages, fewest and most leave out captains and president.</p>
    </section>`;
  }

  function attendanceCard(att, A, B) {
    if (!att.n) return `<span class="eyebrow">By practice attendance</span><p class="muted" style="margin:0">No practices checked in ${sinceText(att)}, so attendance can't change anything yet.</p>`;
    const c1 = Math.ceil(att.n / 3), c2 = Math.ceil((2 * att.n) / 3);
    const ranges = [[c2, att.n], [c1, c2 - 1], [0, c1 - 1]].filter(([lo, hi]) => lo <= hi);
    const groupIn = (run, lo, hi) => run.who.going.filter(p => !isLead(p) && !run.who.late.has(p.id) && (att.count.get(p.id) || 0) >= lo && (att.count.get(p.id) || 0) <= hi);
    const avg = (run, list) => (list.length ? list.reduce((s, p) => s + (run.stats.pts.get(p.id) || 0), 0) / list.length : null);
    const row = (name, la, lb) => { const x = avg(A, la), y = avg(B, lb);
      return `<tr><th scope="row">${name}<small>${people(la.length)}${lb.length !== la.length ? ` (B: ${lb.length})` : ""}</small></th><td>${n1(x)}</td><td>${n1(y)}</td><td>${chg(x, y, true)}</td></tr>`; };
    const lateA = A.who.going.filter(p => A.who.late.has(p.id)), lateB = B.who.going.filter(p => B.who.late.has(p.id));
    return `<span class="eyebrow">By practice attendance</span>
      <div class="deep-card"><table class="sim"><thead><tr><th>Practices made</th><th>A</th><th>B</th><th>Change</th></tr></thead><tbody>
        ${ranges.map(([lo, hi]) => row(`${lo === hi ? lo : lo + "–" + hi} of ${att.n}`, groupIn(A, lo, hi), groupIn(B, lo, hi))).join("")}
        ${lateA.length || lateB.length ? row("Late sign-ups", lateA, lateB) : ""}
      </tbody></table>
      <p class="legend-note">Average points for the day, not counting captains and president. ${plural(att.n, "practice")} ${sinceText(att)}.</p></div>`;
  }

  function peopleCard(A, B) {
    const goingIn = (run, p) => p.active && run.who.state(p.id) !== "away";
    const ids = new Set(activePlayers().filter(p => goingIn(A, p) || goingIn(B, p)).map(p => p.id));
    [A, B].forEach(run => run.stats.pts.forEach((n, id) => { if (P(id)) ids.add(id); }));
    const val = (run, p) => { const n = run.stats.pts.get(p.id) || 0; return goingIn(run, p) || n ? n : null; };
    const by = (x, y) => (x == null ? 1e9 : x) - (y == null ? 1e9 : y);
    const ps = [...ids].map(P).sort((p, q) => by(val(A, p), val(A, q)) || by(val(B, p), val(B, q)) || label(p).localeCompare(label(q)));
    const late = p => { const a = A.who.late.has(p.id) && goingIn(A, p), b = B.who.late.has(p.id) && goingIn(B, p); return a || b ? `<span class="late">${a && b ? "late" : a ? "late in A" : "late in B"}</span>` : ""; };
    const row = p => `<tr><th scope="row"><span class="pl"><i class="dot ${p.gender || ""}"></i>${esc(label(p))}${badge(p)}${late(p)}</span></th><td>${val(A, p) ?? "–"}</td><td>${val(B, p) ?? "–"}</td><td>${chg(val(A, p), val(B, p), false)}</td></tr>`;
    const grp = (name, list) => (list.length ? `<tr class="sim-grp"><th colspan="4">${name} · ${list.length}</th></tr>${list.map(row).join("")}` : "");
    return `<span class="eyebrow">Points per person</span>
      <div class="deep-card"><table class="sim people"><thead><tr><th>Lowest first</th><th>A</th><th>B</th><th>Change</th></tr></thead><tbody>
        ${grp("Captains &amp; president", ps.filter(isLead))}${grp("Women-matching", ps.filter(p => !isLead(p) && p.gender === "W"))}${grp("Men-matching", ps.filter(p => !isLead(p) && p.gender === "M"))}${grp("Matchup not set", ps.filter(p => !isLead(p) && !p.gender))}
      </tbody></table>
      <p class="legend-note">– means not going in that setup. Points already played count as they happened.</p></div>`;
  }

  // Every point of the day for one setup (the one picked with A / B): a row per person, a column
  // per point. A shift is one bar across the points its line plays. Folded away until opened.
  function gridCard(A, B, games) {
    if (!ui.gridOpen) return `<button class="add-dashed" data-act="grid-open" aria-expanded="false">Show who plays every point</button>`;
    const side = ui.view, run = side === "A" ? A : B, cols = [], gameCols = [];
    run.res.games.forEach((g, gi) => {
      let n = 0;
      g.lines.forEach((l, li) => {
        const on = new Set(l.lineup.map(s => s.p)), prev = new Set(li ? g.lines[li - 1].lineup.map(s => s.p) : []);
        for (let k = 0; k < l.plays; k++) cols.push({ gi, k, n: ++n, last: k === l.plays - 1, played: k < l.fixed, five: !!l.five, on, prev });
      });
      gameCols.push(n);
    });
    const gName = gi => (games.list[gi] && games.list[gi].id ? games.list[gi].name : "Game " + (gi + 1));
    const goingIn = p => p.active && run.who.state(p.id) !== "away", pts = run.stats.pts;
    const ps = [...new Set([...activePlayers().filter(goingIn).map(p => p.id), ...[...pts.keys()].filter(P)])].map(P).sort((p, q) => label(p).localeCompare(label(q)));
    const colCls = c => [c.k === 0 && c.n === 1 ? "gs" : "", c.played ? "pd" : ""].filter(Boolean).join(" ");
    const cell = (p, c) => {
      if (!c.on.has(p.id)) return `<td class="${colCls(c)}"></td>`;
      const cls = [isLead(p) ? "L" : p.gender || "U", c.k > 0 ? "jl" : "", c.last ? "" : "jr", c.k === 0 && c.prev.has(p.id) ? "b2b" : ""].filter(Boolean).join(" ");
      return `<td class="${colCls(c)}"><i class="${cls}" title="${esc(label(p))} · ${esc(gName(c.gi))}, point ${c.n}${c.played ? " (played)" : ""}"></i></td>`;
    };
    const row = p => `<tr><th class="nm" scope="row"><span>${esc(label(p))}</span></th>${cols.map(c => cell(p, c)).join("")}<td class="tot">${pts.get(p.id) || 0}</td></tr>`;
    const grp = (name, list) => (list.length ? `<tr class="gg"><th colspan="${cols.length + 2}"><span>${name}</span></th></tr>${list.map(row).join("")}` : "");
    const anyPlayed = cols.some(c => c.played), anyFive = cols.some(c => c.five), anyB2b = run.stats.b2b > 0;
    return `<div class="grid-h"><span class="eyebrow">Every point</span>
        <div class="seg grid-ab" role="group" aria-label="Which setup to show"><button data-act="view" data-v="A" aria-pressed="${side === "A"}">A</button><button data-act="view" data-v="B" aria-pressed="${side === "B"}">B</button></div>
        <button class="text-link on-deep grid-hide" data-act="grid-open" aria-expanded="true">Hide</button></div>
      <div class="deep-card grid-card"><div class="grid-scroll"><table class="pgrid" aria-label="Who plays each point, setup ${side}">
        <thead><tr class="gh"><th class="nm"></th>${gameCols.map((n, gi) => `<th colspan="${n}" class="gs"><span style="width:calc(var(--cw) * ${n})">${esc(gName(gi))}</span></th>`).join("")}<th></th></tr>
          <tr class="ph"><th class="nm"></th>${cols.map(c => `<th class="${[colCls(c), c.five ? "five" : ""].filter(Boolean).join(" ")}"${c.five ? ' title="2 W · 5 M"' : ""}>${c.n}</th>`).join("")}<th class="tot">Pts</th></tr></thead>
        <tbody>${grp("Captains &amp; president", ps.filter(isLead))}${grp("Women-matching", ps.filter(p => !isLead(p) && p.gender === "W"))}${grp("Men-matching", ps.filter(p => !isLead(p) && p.gender === "M"))}${grp("Matchup not set", ps.filter(p => !isLead(p) && !p.gender))}</tbody>
      </table></div>
      <div class="grid-key"><span><i class="k W"></i>Woman</span><span><i class="k M"></i>Man</span><span><i class="k L"></i>Captain / president</span>${anyB2b ? '<span><i class="k M b2b"></i>Back to back</span>' : ""}${anyFive ? '<span><b class="k five">5</b>2 W · 5 M point</span>' : ""}${anyPlayed ? '<span><i class="k pd"></i>Already played</span>' : ""}</div>
      <p class="legend-note">Setup ${side}. A bar is one shift: the points its line plays in a row.${run.who.changed ? ` Uses ${side}'s what-if Who's going.` : ""}</p></div>`;
  }

  function gate(msg, btn) {
    $("#app").innerHTML = `<div class="gate"><div class="gate-card"><span class="gate-logo">${LOGO}</span><h1>Playing time${TAG}</h1><p>${msg}</p>${btn || ""}</div><div class="gate-sea"><div class="wave"></div><div class="gate-foot">Deep Blue Ultimate · Franklin &amp; Marshall</div></div></div>`;
  }

  function render() {
    if (!TOKEN) return gate(`This page needs the ${BOARD}'s team link. Open it from the bottom of Roster on the ${BOARD}.`);
    if (!CODE || problem === "code") return gate(`Open the ${BOARD} on this phone and enter the passcode there first, then come back.`, `<a class="btn primary" href="${esc(boardHref())}">Open the ${BOARD}</a>`);
    if (!S) return gate(problem === "net" ? "Couldn't reach the board. Check your connection and try again." : "Loading…", problem === "net" ? '<button class="btn primary" data-act="retry">Try again</button>' : "");
    restoreWho();
    // Keep keyboard focus on the same control across the redraw.
    const f = document.activeElement, sig = f && f.dataset && f.dataset.act ? ["act", "side", "k", "v", "id"].map(k => f.dataset[k] || "").join("|") : null;
    const head = `<header class="top"><div class="top-in"><a class="brand" href="${esc(boardHref())}" aria-label="Deep Blue, back to the board">${LOGO}<span>Deep Blue</span>${TAG}</a>${offline ? '<span class="sync offline" style="margin-left:auto"><i></i><span>Offline</span></span>' : ""}</div></header>`;
    const t = currentTour();
    let body;
    if (!t) body = `<div class="above"><a class="back-link" href="${esc(boardHref())}">‹ Board</a><h1 class="page-title">Playing time</h1><p class="empty-note">No tournaments yet. Add one on the board's Home, then come back.</p></div>`;
    else {
      const d = currentDay(t), days = daysOf(t), games = dayGames(t, d);
      const att = attendanceFor(t.start_date || d || todayISO(), t.id);
      const shared = { usualPairs: DBLines.usualPairs(S.players, S.points), positions: zoneSets(), priority: attendancePriority(att) };
      const A = runSide(t, d, "A", games, shared), B = runSide(t, d, "B", games, shared);
      const total = A.stats.total, done = A.stats.played;
      const planned = games.list.some(g => g.lines.some(l => !played(l)));
      const step = (act, v, min, max, what) => `<span class="step"><button data-act="${act}" data-v="-1" ${v <= min ? "disabled" : ""} aria-label="Fewer ${what}">−</button><b>${v}</b><button data-act="${act}" data-v="1" ${v >= max ? "disabled" : ""} aria-label="More ${what}">+</button></span>`;
      const extra = games.list.length - Math.min(games.real, games.list.length);
      const gameNames = games.list.filter(g => g.id).map(g => esc(g.name)).join(" · ");
      body = `<div class="above">
        <a class="back-link" href="${esc(boardHref())}">‹ Board</a>
        <div><h1 class="page-title">Playing time</h1><span class="page-sub">What Fill lines would do over a whole tournament day, for two setups side by side. Nothing here changes the board.</span></div>
        <section class="card sim-day">
          <label class="pick">Tournament<select class="line-in" data-act="tour">${[...tours().filter(x => x.start_date).sort(asc), ...tours().filter(x => !x.start_date)].map(x => `<option value="${esc(x.id)}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}${x.start_date ? " · " + fmtDay(x.start_date) : ""}</option>`).join("")}</select></label>
          ${days.length > 1 ? `<label class="pick">Day<select class="line-in" data-act="day">${days.map(x => `<option value="${esc(x)}" ${x === d ? "selected" : ""}>${esc(dayLabel(t, x, true))}</option>`).join("")}</select></label>` : ""}
          <div class="steps"><div class="plays-row"><span class="grow">Games</span>${step("games", games.list.length, games.minN, MAX_GAMES, "games")}</div>
            <div class="plays-row"><span class="grow">Points a game</span>${step("ppg", ui.ppg, PPG_MIN, PPG_MAX, "points a game")}</div></div>
          <p class="note">${gameNames ? `${gameNames}${extra ? ` + ${plural(extra, "more game")} not on the board yet` : ""}.` : `No games on the board for this day yet, so all ${games.list.length} are made up.`}
            ${total} points in all.${done ? ` The ${done} already played count as they happened.` : ""}${planned ? " Lines already planned on the board stay as they are; their empty spots get filled." : ""}</p>
        </section>
        <div class="setup-wrap"><div class="seg wide ab-switch" role="group" aria-label="Which setup to change"><button data-act="view" data-v="A" aria-pressed="${ui.view === "A"}">A · Fill lines now</button><button data-act="view" data-v="B" aria-pressed="${ui.view === "B"}">B · Try</button></div>
        <div class="setups" data-view="${ui.view}">${setupCard(t, "A", A, att)}${setupCard(t, "B", B, att)}</div></div>
        ${summaryCard(A, B)}
      </div>
      <div class="wave" aria-hidden="true"></div><section class="deep"><div class="deep-in">${attendanceCard(att, A, B)}${peopleCard(A, B)}${gridCard(A, B, games)}</div></section>`;
    }
    $("#app").innerHTML = head + `<main id="main">${body}</main>`;
    if (sig) { const el = [...document.querySelectorAll("[data-act]")].find(x => ["act", "side", "k", "v", "id"].map(k => x.dataset[k] || "").join("|") === sig); if (el) el.focus({ preventScroll: true }); }
  }

  // ---------- taps ----------
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "INPUT" || el.tagName === "SELECT" || el.disabled) return;
    const a = el.dataset.act, side = el.dataset.side, v = el.dataset.v;
    const t = S && currentTour();
    if (a === "retry") { problem = ""; render(); load(); return; }
    if (!t) return;
    if (a === "view") { ui.view = v; store.set("sim:view", v); }
    else if (a === "set") { const k = el.dataset.k; ui[side][k] = k === "plays" || k === "caps" ? +v : v; if (side === "B") saveB(); }
    else if (a === "games") { const d = currentDay(t), g = dayGames(t, d); store.set("sim:games", { k: t.id + "|" + d, n: Math.max(g.minN, Math.min(MAX_GAMES, g.list.length + +v)) }); }
    else if (a === "ppg") { ui.ppg = Math.max(PPG_MIN, Math.min(PPG_MAX, ui.ppg + +v)); store.set("sim:ppg", ui.ppg); }
    else if (a === "grid-open") { ui.gridOpen = !ui.gridOpen; store.set("sim:grid", ui.gridOpen); }
    else if (a === "who-open") ui.whoOpen = ui.whoOpen === side ? null : side;
    else if (a === "who") { const s = whoOf(t, side).state(el.dataset.id); ui.who[side] = { ...ui.who[side], [el.dataset.id]: s === "go" ? "late" : s === "late" ? "away" : "go" }; saveWho(); }
    else if (a === "who-reset") { ui.who[side] = {}; saveWho(); }
    else if (a === "b-from-a") { ui.B = { ...ui.A }; ui.who.B = { ...ui.who.A }; saveB(); saveWho(); }
    else if (a === "reset-a") ui.A = fillNow();
    else if (a === "use-b") {
      const b = ui.B;
      store.set("fillCaps", b.caps); store.set("fillRatio", b.ratio); store.set("fillAsk", b.ask); store.set("pairing", b.pairing); store.set("useAtt", b.useAtt); store.set("lateMode", b.lateMode);
      ui.A = { ...fillNow(), plays: b.plays };
      toast(`Fill lines on this phone now uses B. Pick "Each plays ${b.plays}" when you fill.`, 4500);
    }
    else return;
    render();
  });
  document.addEventListener("change", e => {
    const el = e.target, a = el.dataset && el.dataset.act;
    if (a === "set-check") { ui[el.dataset.side][el.dataset.k] = el.checked; if (el.dataset.side === "B") saveB(); }
    else if (a === "tour") { ui.tid = el.value; store.set("sim:tour", ui.tid); ui.day = null; ui.who = { A: {}, B: {} }; ui.whoOpen = null; saveWho(); }
    else if (a === "day") { ui.day = el.value; store.set("sim:day", ui.day); }
    else return;
    render();
  });

  // ---------- load (read-only) ----------
  async function load() {
    try {
      const { data, error } = await sb.rpc("app_load", { p_token: TOKEN, p_code: CODE });
      if (error) throw error;
      setData(data); offline = false; problem = "";
    } catch (e) {
      if (/bad_code/.test((e && e.message) || "")) { problem = "code"; S = null; }
      else { offline = true; if (!S) problem = "net"; }
    }
    if (S && OWNER && !owner) {
      try {
        const d = await sb.rpc("app_owner_load", { p_token: TOKEN, p_code: CODE, p_owner: OWNER });
        if (!d.error && d.data) { owner = { rookies: d.data.rookies || [], apart: toGroups(d.data.apart), together: toGroups(d.data.together) }; dataVer++; }
      } catch (e) { /* run without them */ }
    }
    render();
  }

  if (TOKEN && CODE) {
    // Show what this phone last loaded straight away (bad signal), then the fresh copy.
    const cached = store.get("cache", null);
    if (cached && cached.players) { setData(cached); offline = true; }
    render();
    load();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  } else render();
})();
