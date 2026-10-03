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
  const pairHas = (pairs, a, b) => pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const partnersOf = (pairs, a) => pairs.filter(([x, y]) => x === a || y === a).map(([x, y]) => (x === a ? y : x));

  /* Plan one line.
     opts: players (roster, with id/gender/badge/active), lines (this game's lines, in order),
     idx (which line), prevLines, keep (player ids already on the line; never moved),
     ratio { W, M } (default 3 W / 4 M), leaders per line (default 2), deep (Set of deep-deep ids
     for this game), rookies (Set), apart and together (arrays of [id, id]), seed (string).
     Returns { lineup: [{p, r}], notes: [string] }. */
  function planLine(o) {
    const ratio = o.ratio || { W: 3, M: 4 };
    const wantLeaders = o.leaders == null ? 2 : o.leaders;
    const deep = o.deep || new Set(), rookies = o.rookies || new Set();
    const apart = o.apart || [], together = o.together || [];
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
    function fill(pool, howMany, role) {
      for (const strict of [true, false]) {
        for (const p of order(pool)) {
          if (howMany() <= 0 || line.length >= SLOTS) return;
          if (fits(p, strict)) add(p, role);
        }
      }
    }

    // 1. Two leaders (captains and president), whoever has rested longest.
    const leaderPool = active.filter(isLeader);
    fill(leaderPool, () => wantLeaders - count(isLeader), "H");
    // 2. A deep deep, if this game has any set in Zone and none is on yet.
    if (deep.size && !count(p => deep.has(p.id))) {
      fill(active.filter(p => deep.has(p.id)), () => (count(p => deep.has(p.id)) ? 0 : 1), "");
      if (!count(p => deep.has(p.id))) notes.push("No deep deep fits on this line.");
    }
    // 3. Everyone else by rest. Leaders only if nobody else fits, so they stay near 1 line in 3.
    fill(active.filter(p => !isLeader(p)), () => SLOTS - line.length, "");
    fill(leaderPool, () => SLOTS - line.length, "H");

    if (line.length < SLOTS) notes.push(`Only ${line.length} of ${SLOTS} spots could be filled.`);
    const tiredOn = line.filter(s => tired(byId.get(s.p))).map(s => s.p);
    if (tiredOn.length) notes.push("Back to back: " + tiredOn.length);
    return { lineup: line.slice(0, SLOTS), notes, tired: tiredOn };
  }

  // Are the men falling behind the women? Compares average lines played this game by
  // non-leaders; half a line behind is enough to offer a 5 men / 2 women line.
  // Returns { behind, w, m } where w and m are the average lines played.
  function menBehind(o) {
    const rest = restBefore(o.lines, o.idx, o.prevLines);
    const avg = g => { const ps = o.players.filter(p => p.active !== false && !isLeader(p) && p.gender === g); return ps.length ? ps.reduce((a, p) => a + rest.info(p.id).played, 0) / ps.length : 0; };
    const w = avg("W"), m = avg("M");
    return { behind: o.idx > 0 && w - m >= 0.5, w, m };
  }

  const api = { restBefore, planLine, menBehind, playsOf, SLOTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DBLines = api;
})(typeof window !== "undefined" ? window : this);
