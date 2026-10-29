// Stats at 390 px with ordinary names: the "Tournament › Game" pill doesn't wrap or shrink, so a
// normal-length tournament name makes the whole page scroll sideways.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"]];
(async () => {
  const server = await H.startServer(8784);
  const browser = await H.chromium.launch();
  try {
    for (const [tn, gn] of [["Fall Classic", "vs Haverford"], ["Mid-Atlantic Sectionals", "vs Johns Hopkins"], ["Conference Championships", "vs Swarthmore (quarters)"], ["Philly Fall Invite", "vs Salisbury"], ["Mid-Atlantic Conference Championships", "vs Delaware"], ["Atlantic Coast Open: D-III Women's and Men's", "vs TCNJ"]]) {
      const d = H.seed({ lineups: L }); d.tournaments[0].name = tn; d.games[0].name = gn;
      d.points[0].outcomes = [{ start_on: "O", result: "us", scorer: "w2", assist: "m4" }];
      const be = H.makeBackend(d);
      const A = await H.openBoard(browser, be, server, { name: tn, store: { tab: "stats" } });
      const r = await A.evaluate(() => ({ sw: document.documentElement.scrollWidth, pill: Math.round(document.querySelector(".ctx-pick").getBoundingClientRect().right) }));
      console.log(`${r.sw > 390 ? "OVERFLOW" : "ok      "} "${tn} › ${gn}" (${(tn + gn).length} chars): page scrollWidth=${r.sw}, pill right edge=${r.pill}`);
      if (r.sw > 390 && !process.env.SHOT) { process.env.SHOT = 1; await A.screenshot({ path: (process.env.SP || (require("fs").mkdirSync(require("path").join(__dirname, "shots"), { recursive: true }), require("path").join(__dirname, "shots"))) + "/stats-overflow.png" }); }
      await A.ctx.close();
    }
  } finally { await browser.close(); server.stop(); }
})();
