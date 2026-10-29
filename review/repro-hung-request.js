// No timeout on RPCs: one request that never answers (dead cell connection) blocks every later
// save on that line and all live refreshes, while the header still says Live.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"],["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8777);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    const B = await H.openBoard(browser, be, server, { name: "B" });
    be.net("app_save_point", { board: "A", hang: true });
    await A.click('#pointsTrack button[data-act="od"][data-v="D"]');             // hangs forever
    be.net("app_save_point", null);                                              // signal is back
    await A.waitForTimeout(500);
    await A.click('#pointsTrack button[data-act="result"][data-v="us"]');        // We scored
    await A.waitForTimeout(500);   // human pace (see REVIEW.md #12)
    await A.click('#pointsTrack button[data-act="set-goal"]');                   // scorer
    await A.waitForTimeout(500);   // human pace (see REVIEW.md #12)
    await A.click('#pointsTrack button[data-act="set-assist"]:not([data-p="none"])');
    await A.waitForTimeout(1500);
    // Meanwhile B changes Line 2.
    await B.click('button[data-act="go-line"][data-dir="1"]'); await B.waitForTimeout(300);
    await B.click('#pointsTrack button[data-act="role"][data-k="0"]');
    await A.waitForTimeout(16500);                                                // well past any sensible timeout
    const sync = await A.$eval("#sync", e => e.className);
    const sent = be.log.filter(e => e.board === "A" && e.fn === "app_save_point").length;
    const srv = be.point("p1").outcomes;
    const aLine2 = await A.$eval('.up-row[data-i="1"]', e => e.textContent.replace(/\s+/g, " ")).catch(() => "");
    H.report("18 s later: goal + scorer + assist shown on A still not on the server; header still Live", !(srv || []).some(o => o.result) && /live/.test(sync),
      `A sent ${sent} app_save_point call(s): the hung Line 1 save and Line 2's automatic start-on (Line 1's result/scorer/assist are queued behind the hung one); server Line 1 outcomes=${JSON.stringify(srv)}; A header class="${sync}"; A score shows ${await A.$eval(".score b", e => e.textContent)}`);
    const reloads = be.log.filter(e => e.board === "A" && e.fn === "app_load").length;
    H.report("A stops picking up B's changes (refresh waits on pending>0 forever)", reloads === 1, `A app_load calls after B's change: ${reloads - 1}; server Line 2 slot 1 role="${be.point("p2").lineup[0].r}", A still shows role "${await A.$eval('.up-row[data-i="1"]', () => "").catch(() => "")}"`);
  } finally { await browser.close(); server.stop(); }
})();
