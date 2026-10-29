// gender and badge are put into the page without esc(). The UI only ever sends "W"/"M" and ""/"C"/"P",
// so this needs someone with the team link + passcode to call app_save_player by hand.
const H = require("./harness");
(async () => {
  const server = await H.startServer(8790);
  const browser = await H.chromium.launch();
  try {
    const d = H.seed({ lineups: [["w0","m0","w2","m4","w5","m8","m11"]] });
    d.players[2].gender = `W"><img src=x onerror="window.__xss='gender'">`;
    const be = H.makeBackend(d);
    const A = await H.openBoard(browser, be, server, { name: "A" });
    await A.waitForTimeout(500);
    H.report("Crafted gender value runs script (needs a hand-made RPC call)", (await A.evaluate(() => window.__xss)) === "gender", "window.__xss=" + await A.evaluate(() => window.__xss));
  } finally { await browser.close(); server.stop(); }
})();
