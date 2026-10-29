// autoFill saves whole lines with app_save_point and no "expect" version, built from this phone's
// copy. If another captain just recorded a result on a line that's short a player, it's wiped.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8"], ["w1","m1","w3","m5","w6","m9","m12"]];   // Line 1 is one short (someone got hurt)
(async () => {
  const server = await H.startServer(8776);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    const B = await H.openBoard(browser, be, server, { name: "B" });
    be.net("app_load", { board: "B", res: 4000 });
    await A.click('#pointsTrack button[data-act="result"][data-v="them"]');   // A: they scored Pt 1
    await A.waitForTimeout(800);
    console.log("server Line 1 after A:", JSON.stringify(be.point("p1").outcomes));
    await B.click('button[data-act="game-menu"]');
    await B.click('#sheet-root button[data-act="fill-open"]');
    await B.click('button[data-act="fill-n"][data-v="0"]');
    await B.click('button[data-act="fill-go"]');
    await B.waitForTimeout(6000);
    const out = be.point("p1").outcomes;
    H.report("Fill lines on a slightly stale phone erases the result another captain recorded", !(out || []).some(o => o.result),
      `server Line 1 outcomes now ${JSON.stringify(out)}, lineup ${be.point("p1").lineup.length} players; B saved: ${JSON.stringify(be.log.filter(e => e.board === "B" && e.fn === "app_save_point").map(e => ({ id: e.args.x.id, expect: e.args.x.expect, outcomes: e.args.x.outcomes })))}`);
  } finally { await browser.close(); server.stop(); }
})();
