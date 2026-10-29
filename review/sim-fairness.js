// Back-to-back and spread over a day: 3 games x 13 one-point lines, many random rosters/seeds.
// Usage: node sim-fairness.js [path to lines.js]
const L = require(process.argv[2] || "../lines.js");
function rng(seed) { let h = seed >>> 0 || 1; return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; }; }
let b2b = 0, avoidableNote = 0, lines = 0, spread = [], ratioBad = 0, short = 0;
for (let trial = 0; trial < 300; trial++) {
  const r = rng(trial + 7), nW = 9 + Math.floor(r() * 5), nM = 11 + Math.floor(r() * 5);
  const players = [];
  for (let i = 0; i < nW; i++) players.push({ id: "w" + i, gender: "W", active: true, badge: i < 2 ? "C" : "" });
  for (let i = 0; i < nM; i++) players.push({ id: "m" + i, gender: "M", active: true, badge: i < 4 ? "C" : "" });
  const pick = (pool, n) => pool.slice().sort(() => r() - 0.5).slice(0, n).map(p => p.id);
  const nonLead = players.filter(p => !p.badge), Ws = nonLead.filter(p => p.gender === "W"), Ms = nonLead.filter(p => p.gender === "M");
  const H = [...pick(Ws, 2), ...pick(Ms, 3)], D = [...pick(Ws, 1), ...pick(Ms, 1)], S = [...pick(Ws.filter(p => !D.includes(p.id)), 1), ...pick(Ms.filter(p => !D.includes(p.id)), 1)];
  const used = new Set([...H, ...D, ...S]), spare = nonLead.filter(p => !used.has(p.id)), OKS = process.env.OK ? pick(spare, 4) : [];
  const positions = { handlers: { main: new Set(H), ok: new Set(OKS.slice(0, 2)) }, deep: { main: new Set(D), ok: new Set(OKS.slice(2, 3)) }, short: { main: new Set(S), ok: new Set(OKS.slice(3, 4)) } };
  const day = [];
  for (let g = 0; g < 3; g++) {
    const ls = [], prev = day.length ? day[day.length - 1] : null;
    for (let i = 0; i < 13; i++) {
      ls.push({ id: g + ":" + i, lineup: [], plays: 1, outcomes: [] });
      const out = L.planLine({ players, lines: ls, idx: i, prevLines: prev, dayLines: day, keep: [], ratio: { W: 3, M: 4 }, positions, seed: "s" + trial + ":" + g + ":" + i });
      ls[i].lineup = out.lineup; lines++;
      b2b += out.tired.length;
      const w = out.lineup.filter(s => s.p[0] === "w").length; if (out.lineup.length === 7 && w !== 3) ratioBad++;
      if (out.lineup.length < 7) short++;
    }
    ls.forEach(l => l.outcomes = [{ result: "us" }]);
    day.push(ls);
  }
  const pts = new Map(); day.flat().forEach(l => l.lineup.forEach(s => pts.set(s.p, (pts.get(s.p) || 0) + 1)));
  const np = players.filter(p => !p.badge).map(p => pts.get(p.id) || 0);
  spread.push(Math.max(...np) - Math.min(...np));
}
console.log({ lines, backToBackPlacements: b2b, perGame: +(b2b / 900).toFixed(2), wrongRatioFullLines: ratioBad, shortLines: short, avgSpreadNonLeaderPts: +(spread.reduce((a, b) => a + b, 0) / spread.length).toFixed(2) });
