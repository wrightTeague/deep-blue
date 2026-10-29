// Same root cause as repro-refresh-race.js, worse outcome: a reload that started before Fill lines
// lands after the new lines were saved, so they disappear from this phone. The captain fills again
// and the game now has every new line twice.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8794);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    const B = await H.openBoard(browser, be, server, { name: "B" });
    be.net("app_load", { board: "A", res: 3000 });
    await B.click('#pointsTrack button[data-act="role"][data-k="0"]');      // B changes something -> A reloads (slowly)
    await A.waitForTimeout(600);
    await A.click('button[data-act="game-menu"]');
    await A.click('#sheet-root button[data-act="fill-open"]');
    await A.click('button[data-act="fill-go"]');
    await A.waitForTimeout(800);
    const count = () => A.evaluate(() => document.querySelectorAll(".up-row").length + document.querySelectorAll("#pointsTrack .point").length);
    const right = await count();
    await A.waitForTimeout(2500);                                           // the old reload lands
    const later = await count();
    const srv1 = be.gamePoints("g1").length;
    H.report("Freshly filled lines vanish from the phone", right === 5 && later === 2, `lines on A right after Fill: ${right}; after the slow reload: ${later}; on server: ${srv1}`);
    be.net("app_load", null);
    if (later === right) { H.report("Filling again saves the new lines twice", false, "the lines stayed on screen, so there's no reason to fill again"); return; }
    await A.click('button[data-act="game-menu"]');
    await A.click('#sheet-root button[data-act="fill-open"]');
    await A.click('button[data-act="fill-go"]');
    await A.waitForTimeout(2000);
    H.report("Filling again saves the new lines twice", be.gamePoints("g1").length === 8, `server lines: ${be.gamePoints("g1").length}, pos=${JSON.stringify(be.gamePoints("g1").map(p => p.pos))}`);
  } finally { await browser.close(); server.stop(); }
})();
