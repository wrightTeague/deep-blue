// Drive lines.js directly (same inputs autoFill builds) to inspect line-maker decisions.
const L = require("../lines.js");
const H = require("./harness");
const d = H.seed();
const z = d.team.zone, sets = Object.fromEntries(["handlers", "deep", "short"].map(k => [k, { main: new Set(z[k]), ok: new Set(z[k + "_ok"]) }]));
const byId = new Map(d.players.map(p => [p.id, p]));
const show = lu => lu.map(s => { const p = byId.get(s.p); return p.nick + (p.badge ? "*" : "") + (s.r ? "(" + s.r + ")" : ""); }).join(" ");
function plan(lines, i, extra) {
  return L.planLine({ players: d.players, lines, idx: i, prevLines: null, dayLines: [], keep: (lines[i].lineup || []).map(s => s.p), keepRoles: {}, ratio: { W: 3, M: 4 }, pairing: "rotate", usualPairs: [], positions: sets, rookies: new Set(), apart: [], together: [], seed: "g1:" + i, priority: {}, late: new Set(), lateLess: 0, ...(extra || {}) });
}
const lines = [];
for (let i = 0; i < Number(process.argv[2] || 3); i++) {
  lines.push({ id: "n" + i, lineup: [], plays: 1, outcomes: [] });
  const r = plan(lines, i);
  lines[i].lineup = r.lineup;
  console.log(`Line ${i + 1}: ${show(r.lineup)}  ${r.notes.join(" | ")}`);
}
module.exports = { plan, sets, d };
