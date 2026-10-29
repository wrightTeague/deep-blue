// Paste reads ui.clip when its save actually runs, not when you tap Paste. If an earlier save
// on that line is still going and you tap Done (clears the clipboard), the paste throws and is
// dropped without a message.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3"]];
(async () => {
  const server = await H.startServer(8778);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    // Copy Line 1.
    await A.click('#pointsTrack button[data-act="point-menu"]');
    await A.click('button[data-act="pm-copy"]');
    await A.click('button[data-act="go-line"][data-dir="1"]'); await A.waitForTimeout(300);
    be.net("app_save_point", { board: "A", res: 2000 });                   // slow signal
    await A.click('#pointsTrack button[data-act="role"][data-k="0"]');      // a quick edit on Line 2 first
    await A.click('#pointsTrack button[data-act="paste-line"]');            // then Paste Line 1's players
    const shown = await H.lineNames(A);
    await A.click('.clipbar button[data-act="clip-done"]');                 // and Done
    await A.waitForTimeout(5000);
    const srv = be.point("p2").lineup.map(s => s.p);
    const after = await H.lineNames(A);
    H.report("Pasted players shown, then silently gone; never saved", shown.length === 7 && srv.length === 3,
      `shown right after Paste: ${shown.length} players; server Line 2: ${srv.length} players; screen now: ${after.length}; page errors: ${JSON.stringify(A.errors || [])}`);
  } finally { await browser.close(); server.stop(); }
})();
