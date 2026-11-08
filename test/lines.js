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
     seed (string), dayLines (earlier games today, for rotating leader partners),
     priority ({ id: number }: a nudge in "lines sat". Positive = goes out sooner (good practice
     attendance), negative = later (late tournament sign-up). Never-played-yet players are
     ordered by it first, so it decides who starts.) priorityMode "played" puts the nudge
     after lines sat instead (only breaks ties), "lines" (default) adds it to lines sat.
     late (Set of late sign-ups: their first shift comes after everyone else's), lateLess
     (number of lines to take off late sign-ups all day; 0 = they just start later).
     Returns { lineup: [{p, r}], notes: [string] }. */
  function planLine(o) {
    const ratio = o.ratio || { W: 3, M: 4 };
    const wantLeaders = o.leaders == null ? 2 : o.leaders;
    // "1" captain per line means at least 1, at most 2: a second one can go out when they're
    // as rested as everyone else (or needed for a zone spot), but it's never forced.
    const maxLeaders = wantLeaders === 1 ? 2 : wantLeaders;
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
    // Nudges (see opts): attendance moves people up, a late sign-up starts after everyone
    // else's first shift, and with lateLess also carries a small penalty all day.
    const late = o.late || new Set();
    const pri = id => ((o.priority && +o.priority[id]) || 0) - (late.has(id) ? +o.lateLess || 0 : 0);
    const firstShift = id => (late.has(id) ? 5e8 : 1e9);
    const key = p => { const i = rest.info(p.id), b = pri(p.id), fresh = i.lines === null;
      return o.priorityMode === "played" ? [fresh ? firstShift(p.id) + b : i.lines, -i.played + b, big(i.pts), tie.get(p.id) || 0]
        : [fresh ? firstShift(p.id) + b : i.lines + b, -i.played, big(i.pts), tie.get(p.id) || 0]; };
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
    function fill(pool, howMany, role, modes, ok) {
      for (const strict of modes || [true, false]) {
        for (const p of order(pool)) {
          if (howMany() <= 0 || line.length >= SLOTS) return;
          if (fits(p, strict) && (!ok || ok(p))) add(p, typeof role === "function" ? role(p) : role);
        }
      }
    }

    // 1. Two leaders (captains and president). The one who has rested longest goes first.
    //    Their partner depends on o.pairing:
    //    "rest"   – whoever else has rested longest (the same pairs tend to come back);
    //    "usual"  – their usual partner (o.usualPairs), except every third round of three
    //               lines, which mixes with whoever they've played with least today;
    //    "rotate" – (default) whoever they've played with least today.
    const leaderPool = active.filter(isLeader);
    const together2 = new Map();   // "a|b" → lines together today
    const pk = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
    const countIn = l => { const ids = (l.lineup || []).map(s => s.p).filter(id => byId.has(id) && isLeader(byId.get(id)));
      for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) together2.set(pk(ids[x], ids[y]), (together2.get(pk(ids[x], ids[y])) || 0) + 1); };
    (o.dayLines || []).forEach(game => (game || []).forEach(l => { if (resultsOf(l)) countIn(l); }));
    for (let i = 0; i < o.idx; i++) countIn(o.lines[i]);
    const mode = o.pairing || "rotate";
    const usual = new Map(); (o.usualPairs || []).forEach(([a, b]) => { usual.set(a, b); usual.set(b, a); });
    const linesToday = (o.dayLines || []).reduce((n, game) => n + (game || []).filter(l => resultsOf(l)).length, 0) + o.idx;
    const mixedRound = Math.floor(linesToday / 3) % 3 === 2;
    // "usual": leaders go out in rounds of three lines, each leader once per round. Two rounds
    // out of three use the usual pairs; the third uses the mix they've played together least.
    // Within a round, the pair that has rested longest goes first (never back to back).
    const seqToday = [...(o.dayLines || []).flatMap(game => (game || []).filter(l => resultsOf(l))), ...o.lines.slice(0, o.idx)];
    const usedThisRound = new Set(seqToday.slice(seqToday.length - (linesToday % 3)).flatMap(l => (l.lineup || []).map(s => s.p)));
    function matchings(ids) {
      if (ids.length < 2) return [[]];
      const [a, ...more] = ids, out = [];
      more.forEach((b, i) => matchings(more.filter((_, j) => j !== i)).forEach(m => out.push([[a, b], ...m])));
      return out;
    }
    function usualRoundPick(cands, on) {
      const avail = leaderPool.filter(p => !usedThisRound.has(p.id) || on.includes(p.id)).map(p => p.id);
      if (avail.length < 2 || avail.length % 2 || avail.length > 8) return null;
      const isUsual = ([a, b]) => usual.get(a) === b;
      const score = m => m.reduce((t, pr) => t + (isUsual(pr) ? (mixedRound ? 10 : -10) : 0) + (together2.get(pk(pr[0], pr[1])) || 0), 0);
      const best = matchings(avail).sort((x, y) => score(x) - score(y))[0];
      const ok = new Set(cands.map(p => p.id)), restOf = id => { const v = rest.info(id).lines; return v === null ? 99 : v; };
      const pairs = best.filter(([a, b]) => (ok.has(a) || on.includes(a)) && (ok.has(b) || on.includes(b)) && (!on.length || on.includes(a) || on.includes(b)));
      if (!pairs.length) return null;
      const pr = pairs.sort((x, y) => (restOf(y[0]) + restOf(y[1])) - (restOf(x[0]) + restOf(x[1])))[0];
      const id = pr.find(x => !on.includes(x));
      return id ? cands.find(p => p.id === id) || null : null;
    }
    for (const strict of [true, false]) {
      while (count(isLeader) < wantLeaders && line.length < SLOTS) {
        const cands = order(leaderPool).filter(p => fits(p, strict));
        if (!cands.length) break;
        const on = line.map(s => s.p).filter(id => isLeader(byId.get(id)));
        const seen = p => on.reduce((a, id) => a + (together2.get(pk(id, p.id)) || 0), 0);
        let pick = cands[0];
        // Usual rounds: start with the most-rested leader whose usual partner is also ready.
        const roundPick = mode === "usual" ? usualRoundPick(cands, on) : null;
        if (roundPick) { add(roundPick, "H"); continue; }
        if (on.length && mode !== "rest") {
          const mate = on.length === 1 ? usual.get(on[0]) : null;
          const fresh = cands.map((p, k) => ({ p, k })).sort((a, b) => seen(a.p) - seen(b.p) || a.k - b.k);
          pick = fresh[0].p;
        }
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
    // Most constrained spot first (fewest people listed): filling handlers first can use up the
    // last W or M slot that the only rested short deep needed, and then someone goes back to back.
    const listed = k => (pos[k] ? active.filter(p => inList(k, p.id)).length : Infinity);
    needs.sort((a, b) => listed(a[0]) - listed(b[0]));
    for (const [k, name, missing] of needs) {
      if (!pos[k] || !((pos[k].main && pos[k].main.size) || (pos[k].ok && pos[k].ok.size))) continue;
      const main = active.filter(p => pos[k].main && pos[k].main.has(p.id)), ok = active.filter(p => pos[k].ok && pos[k].ok.has(p.id));
      // Main list rested, then backups rested; a third captain only if no one else rested
      // fits; then the same again allowing back to back.
      const spare = p => !wantLeaders || !isLeader(p) || count(isLeader) < maxLeaders;   // 0 captains per line: they're like anyone else
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
    // With 0 captains per line set aside, captains are just players.
    // With 1 per line, a second captain can come in here by rest like anyone else.
    if (!wantLeaders) fill(active, () => SLOTS - line.length, "");
    else if (maxLeaders > wantLeaders) { fill(active, () => SLOTS - line.length, p => (isLeader(p) ? "H" : ""), undefined, p => !isLeader(p) || count(isLeader) < maxLeaders); fill(leaderPool, () => SLOTS - line.length, "H"); }
    else { fill(active.filter(p => !isLeader(p)), () => SLOTS - line.length, ""); fill(leaderPool, () => SLOTS - line.length, "H"); }

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

  // Usual captain pairs: from every past line with a result, the pairs of leaders who played
  // together most, taken greedily so nobody is in two pairs. → [[id, id], ...]
  function usualPairs(players, pastLines) {
    const lead = new Set(players.filter(p => p.active !== false && isLeader(p)).map(p => p.id)), n = new Map();
    (pastLines || []).forEach(l => { if (!resultsOf(l)) return; const ids = (l.lineup || []).map(s => s.p).filter(id => lead.has(id));
      for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) { const k = [ids[x], ids[y]].sort().join("|"); n.set(k, (n.get(k) || 0) + 1); } });
    const used = new Set(), out = [];
    [...n.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).forEach(([k]) => { const [a, b] = k.split("|"); if (!used.has(a) && !used.has(b)) { used.add(a); used.add(b); out.push([a, b]); } });
    return out;
  }

  // Are the men falling behind the women over the whole day? With 4 of the 6 leaders being
  // men, 3:4 lines give non-leader women a bit more time than non-leader men, and it adds up
  // across games. Compares average points played by non-leaders today: earlier games that
  // day (o.dayLines, a list of each game's lines; only points with a result count) plus this
  // game's lines before idx (as planned). A point or more behind → offer a 5:2 line.
  // Returns { behind, w, m } with w and m the average points played today.
  // Spacing, so 5:2 lines come at a steady interval instead of in clumps (tuned over a few
  // hundred simulated tournaments): normally at least 2 regular lines since the last one
  // (earlier games today count); once the men are 1.5 points behind, 1; at 2 behind, none.
  const GAP = 1, SPACING = [[2, 0], [1.5, 1], [-Infinity, 2]];
  function menBehind(o) {
    const g = new Map(o.players.map(p => [p.id, p.gender]));
    const isFive = l => { const gs = ((l && l.lineup) || []).map(s => g.get(s.p)); return gs.filter(x => x === "W").length === 2 && gs.filter(x => x === "M").length >= 5; };
    const pts = new Map(), add = (lu, n) => (lu || []).forEach(s => pts.set(s.p, (pts.get(s.p) || 0) + n));
    (o.dayLines || []).forEach(game => (game || []).forEach(l => add(l.lineup, resultsOf(l))));
    for (let i = 0; i < o.idx; i++) add(o.lines[i].lineup, playsOf(o.lines[i]));
    const avg = g => { const ps = o.players.filter(p => p.active !== false && !isLeader(p) && p.gender === g); return ps.length ? ps.reduce((a, p) => a + (pts.get(p.id) || 0), 0) / ps.length : 0; };
    const w = avg("W"), m = avg("M"), gap = o.gap == null ? GAP : o.gap;
    const look = SPACING.find(([d]) => w - m >= d)[1];
    const tooSoon = look > 0 && [...(o.dayLines || []).flat(), ...o.lines.slice(0, o.idx)].slice(-look).some(isFive);
    return { behind: !tooSoon && (w > 0 || m > 0) && w - m >= gap, w, m };
  }

  /* Playing-time simulator: run the line maker over one whole tournament day. Nothing is saved.
     o: what planLine takes (players = who's going, ratio, leaders, pairing, usualPairs,
     positions, rookies, apart, together, priority, priorityMode, late, lateLess), plus
       games: [{ id, lines }] the day's games in play order, each with its lines from the board
              (id null for a made-up game),
       ppg:   points per game, plays: points per new line,
       five:  say yes whenever menBehind offers a 2 W / 5 M line (pass it only with 3 W / 4 M).
     Points with a result count as played. Games before the last one with a result are over at
     the points they played; the rest run to ppg points. In a game, a line with no result that
     comes before one with a result was skipped. Lines already planned keep the players on them
     who are going and get their empty spots filled; new lines make up the rest of each game.
     → { games: [{ id, lines: [{ lineup, plays, fixed, five }] }], points: [{ g, ids, five, played }],
         fives: lines made 2 W / 5 M, short: lines with fewer than 7 } */
  function simDay(o) {
    const byId = new Map(o.players.map(p => [p.id, p]));
    const here = id => { const p = byId.get(id); return !!p && p.active !== false; };
    const ppg = Math.max(1, Math.round(+o.ppg) || 11), plays = Math.max(1, Math.min(4, Math.round(+o.plays) || 1));
    const games = o.games || [];
    const lastPlayed = games.reduce((k, g, i) => ((g.lines || []).some(resultsOf) ? i : k), -1);
    const done = [], points = [];
    let fives = 0, short = 0;
    const copy = l => (l.lineup || []).map(s => ({ p: s.p, r: s.r || "" }));
    games.forEach((g, gi) => {
      const src = g.lines || [];
      const lastLine = src.reduce((k, l, i) => (resultsOf(l) ? i : k), -1);
      const playedPts = src.reduce((n, l) => n + resultsOf(l), 0);
      let left = (gi < lastPlayed ? playedPts : Math.max(playedPts, ppg)) - playedPts;
      const lines = [];
      src.forEach((l, i) => {
        const r = resultsOf(l);
        if (i < lastLine) { if (r) lines.push({ lineup: copy(l), plays: r, fixed: r }); return; }
        if (i === lastLine) { const more = Math.max(0, Math.min(playsOf(l) - r, left)); left -= more; lines.push({ lineup: copy(l), plays: r + more, fixed: r }); return; }
        if (left <= 0) return;
        const n = Math.min(playsOf(l), left); left -= n;
        lines.push({ lineup: copy(l), plays: n, fixed: 0 });
      });
      while (left > 0) { const n = Math.min(plays, left); left -= n; lines.push({ lineup: [], plays: n, fixed: 0 }); }
      const dayLines = done.map(d => d.lines), prevLines = gi > 0 ? done[gi - 1].lines : null;
      lines.forEach((l, i) => {
        if (l.fixed) return;
        const keep = l.lineup.map(s => s.p).filter(here);
        if (keep.length >= SLOTS) return;   // a full planned line: Fill lines leaves it alone
        let ratio = o.ratio || { W: 3, M: 4 };
        if (o.five && menBehind({ players: o.players, lines, idx: i, dayLines }).behind) { ratio = { W: 2, M: 5 }; l.five = true; fives++; }
        const r = planLine({ ...o, ratio, lines, idx: i, prevLines, dayLines, keep, keepRoles: Object.fromEntries(l.lineup.map(s => [s.p, s.r || ""])),
          seed: (g.id || "sim:" + gi) + ":" + i });
        l.lineup = r.lineup;
        if (r.lineup.length < SLOTS) short++;
      });
      // Every point of the finished day counts as played, for the games after it.
      lines.forEach(l => { l.outcomes = Array.from({ length: l.plays }, () => ({ result: "sim" })); });
      lines.forEach(l => { for (let k = 0; k < l.plays; k++) points.push({ g: gi, ids: l.lineup.map(s => s.p), five: !!l.five, played: k < l.fixed }); });
      done.push({ id: g.id || null, lines });
    });
    return { games: done, points, fives, short };
  }

  const api = { restBefore, planLine, menBehind, assignSpots, usualPairs, simDay, playsOf, toPairs, SLOTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DBLines = api;
})(typeof window !== "undefined" ? window : this);
