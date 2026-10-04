/* Deep Blue line maker (test board only).
   Pure functions, no DOM: given the roster, the game's lines so far and the previous game's
   lines, pick the players for one line. Loaded in the browser as window.DBLines and in Node
   (for testing) through module.exports. */
(function (root) {
  "use strict";

  const SLOTS = 7;
  const playsOf = pt => Math.max(1, Math.min(4, +pt.plays || 2));
  const resultsOf = pt => (Array.isArray(pt.outcomes) ? pt.outcomes : []).slice(0, playsOf(pt)).filter(o => o && o.result).length;

  // How long each player has sat going into line idx, and how many lines they've played this
  // game. Within the game, lines count the points they're set to play; the previous game
  // counts only points that got a result. info(id) → { pts, lines, played }; pts and lines
  // are null when someone hasn't played this game or the previous one.
  function restBefore(lines, idx, prevLines) {
    const last = new Map(), played = new Map();
    let pt = 0, line = 0;
    (prevLines || []).forEach(l => {
      const n = resultsOf(l); if (!n) return;
      pt += n; line++; (l.lineup || []).forEach(s => last.set(s.p, { pt, line }));
    });
    const prevPts = pt;
    for (let i = 0; i < idx; i++) {
      pt += playsOf(lines[i]); line++;
      (lines[i].lineup || []).forEach(s => { last.set(s.p, { pt, line }); played.set(s.p, (played.get(s.p) || 0) + 1); });
    }
    return {
      any: idx > 0 || prevPts > 0,
      info: id => { const e = last.get(id); return { pts: e ? pt - e.pt : null, lines: e ? line - e.line : null, played: played.get(id) || 0 }; },
    };
  }

  // Small deterministic shuffle so ties don't always break the same way (which would keep the
  // same groups together all game). Same game + line gives the same answer.
  function seeded(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  }

  const isLeader = p => p.badge === "C" || p.badge === "P";
  // Keep-apart / keep-together come in as one person and a list ({ p, with: [ids] }); older
  // settings were plain pairs ([a, b]). Either way, work with pairs.
  const toPairs = list => (list || []).flatMap(x => Array.isArray(x) ? [x] : (x && x.p ? (x.with || []).map(y => [x.p, y]) : []));
  const pairHas = (pairs, a, b) => pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const partnersOf = (pairs, a) => pairs.filter(([x, y]) => x === a || y === a).map(([x, y]) => (x === a ? y : x));

  /* Plan one line.
     opts: players (roster, with id/gender/badge/active), lines (this game's lines, in order),
     idx (which line), prevLines, keep (player ids already on the line; never moved),
     ratio { W, M } (default 3 W / 4 M), leaders per line (default 2),
     positions ({ handlers, deep, short }, each { main: Set, ok: Set } for "can play it if
     needed"), deep (older single Set of deep deeps, used when positions has none), rookies (Set), apart and together (lists of { p, with: [ids] } or [id, id]),
     seed (string), dayLines (earlier games today, for rotating leader partners).
     Returns { lineup: [{p, r}], notes: [string] }. */
  function planLine(o) {
    const ratio = o.ratio || { W: 3, M: 4 };
    const wantLeaders = o.leaders == null ? 2 : o.leaders;
    const deep = o.deep || new Set(), rookies = o.rookies || new Set();
    const apart = toPairs(o.apart), together = toPairs(o.together);
    const rest = restBefore(o.lines, o.idx, o.prevLines);
    const next = o.lines[o.idx + 1], nextOn = new Set(((next && next.lineup) || []).map(s => s.p));
    const byId = new Map(o.players.map(p => [p.id, p]));
    const notes = [];

    const line = (o.keep || []).filter(id => byId.has(id)).map(id => ({ p: id, r: (o.keepRoles && o.keepRoles[id]) || "" }));
    const on = () => new Set(line.map(s => s.p));
    const count = test => line.filter(s => test(byId.get(s.p))).length;
    const left = g => (g === "W" ? ratio.W : ratio.M) - count(p => p.gender === g);

    const active = o.players.filter(p => p.active !== false);
    const rookieShare = active.length ? active.filter(p => rookies.has(p.id)).length / active.length : 0;
    const rookieCap = Math.max(1, Math.ceil(SLOTS * rookieShare));

    const rnd = seeded(o.seed || "x");
    const tie = new Map(active.map(p => [p.id, rnd()]));
    // Who should go out next: most lines sat (never on yet = first), then fewest lines played,
    // then most points sat.
    const big = v => (v === null ? 1e9 : v);
    const key = p => { const i = rest.info(p.id); return [big(i.lines), -i.played, big(i.pts), tie.get(p.id) || 0]; };
    const order = list => list.slice().sort((a, b) => { const x = key(a), y = key(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return y[k] - x[k]; return 0; });
    const tired = p => rest.info(p.id).lines === 0 || nextOn.has(p.id);   // back to back either side

    function fits(p, strict) {
      if (on().has(p.id)) return false;
      if (p.gender === "W" || p.gender === "M") { if (left(p.gender) <= 0) return false; }
      else if (line.length >= SLOTS) return false;
      if (line.some(s => pairHas(apart, s.p, p.id))) return false;            // never broken
      if (strict && tired(p)) return false;
      if (strict && rookies.has(p.id) && count(x => rookies.has(x.id)) >= rookieCap) return false;
      return true;
    }
    function add(p, role) {
      line.push({ p: p.id, r: role || "" });
      // Keep-together partners come along if they fit.
      partnersOf(together, p.id).forEach(id => { const q = byId.get(id); if (q && q.active !== false && line.length < SLOTS && fits(q, true)) line.push({ p: q.id, r: isLeader(q) ? "H" : "" }); });
    }
    function fill(pool, howMany, role, modes) {
      for (const strict of modes || [true, false]) {
        for (const p of order(pool)) {
          if (howMany() <= 0 || line.length >= SLOTS) return;
          if (fits(p, strict)) add(p, role);
        }
      }
    }

    // 1. Two leaders (captains and president). The one who has rested longest goes first;
    //    their partner is the rested leader they've played with least today, so partners
    //    rotate through the day instead of the same pairs coming back every third line.
    const leaderPool = active.filter(isLeader);
    const together2 = new Map();   // "a|b" → lines together today
    const pk = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
    const countIn = l => { const ids = (l.lineup || []).map(s => s.p).filter(id => byId.has(id) && isLeader(byId.get(id)));
      for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) together2.set(pk(ids[x], ids[y]), (together2.get(pk(ids[x], ids[y])) || 0) + 1); };
    (o.dayLines || []).forEach(game => (game || []).forEach(l => { if (resultsOf(l)) countIn(l); }));
    for (let i = 0; i < o.idx; i++) countIn(o.lines[i]);
    for (const strict of [true, false]) {
      while (count(isLeader) < wantLeaders && line.length < SLOTS) {
        const cands = order(leaderPool).filter(p => fits(p, strict));
        if (!cands.length) break;
        const on = line.map(s => s.p).filter(id => isLeader(byId.get(id)));
        const seen = p => on.reduce((a, id) => a + (together2.get(pk(id, p.id)) || 0), 0);
        const pick = on.length ? cands.map((p, k) => ({ p, k })).sort((a, b) => seen(a.p) - seen(b.p) || a.k - b.k)[0].p : cands[0];
        add(pick, "H");
      }
    }
    // 2. Zone spots: at least 2 handlers, plus a deep deep and a short deep (two different
    //    people). The main list goes first; the "can play it if needed" list only when nobody
    //    on the main list fits. A spot with nobody listed is skipped.
    const pos = o.positions || {};
    const inList = (k, id) => !!(pos[k] && ((pos[k].main && pos[k].main.has(id)) || (pos[k].ok && pos[k].ok.has(id))));
    const handlersOn = () => count(p => inList("handlers", p.id));
    // Who on the line covers deep and short, with nobody doing both.
    const dShort = () => {
      const ids = line.map(s => s.p);
      const tryAssign = (d, sh) => d !== sh && inList("deep", d) && inList("short", sh);
      let deepOk = ids.some(id => inList("deep", id)), shortOk = ids.some(id => inList("short", id));
      if (deepOk && shortOk && !ids.some(d => ids.some(sh => tryAssign(d, sh)))) shortOk = false;   // only one person covers both
      return { deep: deepOk, short: shortOk };
    };
    const needs = [
      ["handlers", "handlers", () => 2 - handlersOn(), 2],
      ["deep", "deep deep", () => (dShort().deep ? 0 : 1), 1],
      ["short", "short deep", () => (dShort().short ? 0 : 1), 1],
    ];
    for (const [k, name, missing] of needs) {
      if (!pos[k] || !((pos[k].main && pos[k].main.size) || (pos[k].ok && pos[k].ok.size))) continue;
      const main = active.filter(p => pos[k].main && pos[k].main.has(p.id)), ok = active.filter(p => pos[k].ok && pos[k].ok.has(p.id));
      // Main list rested, then backups rested; a third captain only if no one else rested
      // fits; then the same again allowing back to back.
      const spare = p => !isLeader(p) || count(isLeader) < wantLeaders;
      for (const strict of [true, false]) {
        for (const pool of [main, ok]) if (missing() > 0) fill(pool.filter(spare), missing, "", [strict]);
        for (const pool of [main, ok]) if (missing() > 0) fill(pool, missing, "", [strict]);
      }
      if (missing() > 0) notes.push(k === "handlers" ? "Fewer than 2 handlers fit." : `No ${name} fits.`);
    }
    // Older single list of deep deeps (games outside a tournament).
    if (!pos.deep && deep.size && !count(p => deep.has(p.id))) {
      fill(active.filter(p => deep.has(p.id)), () => (count(p => deep.has(p.id)) ? 0 : 1), "");
      if (!count(p => deep.has(p.id))) notes.push("No deep deep fits.");
    }
    // 3. Everyone else by rest. Leaders only if nobody else fits, so they stay near 1 line in 3.
    fill(active.filter(p => !isLeader(p)), () => SLOTS - line.length, "");
    fill(leaderPool, () => SLOTS - line.length, "H");

    // Roles: when there's a Handlers list, its picks get H (up to 3) and everyone else C.
    // Players you placed keep the role you gave them.
    if (pos.handlers && ((pos.handlers.main && pos.handlers.main.size) || (pos.handlers.ok && pos.handlers.ok.size))) {
      const keepSet = new Set(o.keep || []), picks = assignSpots(line.map(s => s.p), pos).handlers;
      let h = line.filter(s => keepSet.has(s.p) && s.r === "H").length;
      line.forEach(s => {
        if (keepSet.has(s.p) && s.r) return;
        s.r = picks.includes(s.p) && h < 3 ? (h++, "H") : "C";
      });
    }
    if (line.length < SLOTS) notes.push(`Only ${line.length} of ${SLOTS} spots could be filled.`);
    const tiredOn = line.filter(s => tired(byId.get(s.p))).map(s => s.p);
    if (tiredOn.length) notes.push("Back to back: " + tiredOn.length);
    return { lineup: line.slice(0, SLOTS), notes, tired: tiredOn };
  }

  // Who on a line would play which spot, from the zone lists (positions as in planLine).
  // → { handlers: up to 3 ids, deep: id | null, short: id | null }. Deep and short are two
  // different people; the main list beats the backup list. Zone spots are defense and
  // handling is offense, so the same person can be a handler and the deep deep.
  function assignSpots(ids, positions) {
    const pos = positions || {};
    const lvl = (k, id) => (pos[k] ? (pos[k].main && pos[k].main.has(id) ? 2 : pos[k].ok && pos[k].ok.has(id) ? 1 : 0) : 0);
    const handlers = ids.map((id, i) => ({ id, i, l: lvl("handlers", id) })).filter(x => x.l).sort((a, b) => b.l - a.l || a.i - b.i).slice(0, 3).map(x => x.id);
    const dC = [null, ...ids.filter(id => lvl("deep", id))], sC = [null, ...ids.filter(id => lvl("short", id))];
    let best = { deep: null, short: null, score: -1 };
    for (const d of dC) for (const sh of sC) {
      if (d && sh && d === sh) continue;
      const score = (d ? 10.5 + lvl("deep", d) : 0) + (sh ? 10 + lvl("short", sh) : 0);   // deep deep wins a tie
      if (score > best.score) best = { deep: d, short: sh, score };
    }
    return { handlers, deep: best.deep, short: best.short };
  }

  // Are the men falling behind the women over the whole day? With 4 of the 6 leaders being
  // men, 3:4 lines give non-leader women a bit more time than non-leader men, and it adds up
  // across games. Compares average points played by non-leaders today: earlier games that
  // day (o.dayLines, a list of each game's lines; only points with a result count) plus this
  // game's lines before idx (as planned). A point or more behind → offer a 5:2 line.
  // Returns { behind, w, m } with w and m the average points played today.
  const GAP = 1;
  function menBehind(o) {
    const pts = new Map(), add = (lu, n) => (lu || []).forEach(s => pts.set(s.p, (pts.get(s.p) || 0) + n));
    (o.dayLines || []).forEach(game => (game || []).forEach(l => add(l.lineup, resultsOf(l))));
    for (let i = 0; i < o.idx; i++) add(o.lines[i].lineup, playsOf(o.lines[i]));
    const avg = g => { const ps = o.players.filter(p => p.active !== false && !isLeader(p) && p.gender === g); return ps.length ? ps.reduce((a, p) => a + (pts.get(p.id) || 0), 0) / ps.length : 0; };
    const w = avg("W"), m = avg("M"), gap = o.gap == null ? GAP : o.gap;
    return { behind: (w > 0 || m > 0) && w - m >= gap, w, m };
  }

  const api = { restBefore, planLine, menBehind, assignSpots, playsOf, toPairs, SLOTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DBLines = api;
})(typeof window !== "undefined" ? window : this);
