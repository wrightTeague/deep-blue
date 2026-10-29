// One tap in a line's ⋯ menu permanently destroys recorded results: no confirm, no undo.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8781);
  const browser = await H.chromium.launch();
  try {
    const d = H.seed({ lineups: L });
    d.points[0].plays = 2;
    d.points[0].outcomes = [{ start_on: "O", result: "us", scorer: "w2", assist: "m4" }, { start_on: "D", result: "us", scorer: "m8", assist: "w0" }];
    for (const [act, label] of [["pm-clear", "Clear players"], ["pm-plays", "Plays → 1"], ["pm-clear-result", "Clear results"]]) {
      const be = H.makeBackend(d);
      const A = await H.openBoard(browser, be, server, { name: act });
      await A.click('button[data-act="go-line"][data-dir="-1"]'); await A.waitForTimeout(300);
      await A.click('#pointsTrack button[data-act="point-menu"]');
      await A.click(act === "pm-plays" ? 'button[data-act="pm-plays"][data-v="1"]' : `button[data-act="${act}"]`);
      await A.waitForTimeout(1000);
      const o = be.point("p1").outcomes;
      const goals = o.filter(x => x.scorer).length;
      const undo = await A.$('.clipbar button[data-act*="undo"]');
      H.report(`${label}: one tap, goals left ${goals}/2, undo offered: ${!!undo}`, goals < 2 && !undo, JSON.stringify(o));
    }
  } finally { await browser.close(); server.stop(); }
})();
