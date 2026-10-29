// Two captains press Fill lines within a second or two. Both plan from the same lines with the same
// seed, so they make identical lines with the same pos numbers: the board ends up with each new
// line twice in a row (the same 7 people back to back) and duplicate positions.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8780);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    const B = await H.openBoard(browser, be, server, { name: "B" });
    be.net("app_load", { res: 1500 });     // ordinary bad-signal reload time
    for (const P of [A, B]) { await P.click('button[data-act="game-menu"]'); await P.click('#sheet-root button[data-act="fill-open"]'); }
    await A.click('button[data-act="fill-go"]');
    await B.waitForTimeout(600);
    await B.click('button[data-act="fill-go"]');
    await A.waitForTimeout(6000);
    const pts = be.gamePoints("g1");
    const key = p => p.lineup.map(s => s.p).sort().join(",");
    const pos = pts.map(p => p.pos);
    const twins = pts.filter((p, i) => i && key(p) === key(pts[i - 1])).length;
    H.report("Duplicate positions and identical back-to-back lines", new Set(pos).size < pos.length && twins > 0,
      `${pts.length} lines; pos=${JSON.stringify(pos)}; identical neighbouring lineups: ${twins}`);
    const shown = await A.$$eval(".up-row b", els => els.map(e => e.textContent));
    console.log("A's line list now:", shown.join(" | "));
  } finally { await browser.close(); server.stop(); }
})();
