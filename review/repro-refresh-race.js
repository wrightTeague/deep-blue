// A refresh that was already in flight lands after a tap was saved and puts the old line back on
// screen. A second tap then toggles against the real (newer) server copy and undoes the first.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"],["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8772);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    // Bad signal for A's reloads only: the full app_load answer takes 2.5 s to come back.
    be.net("app_load", { board: "A", res: 2500 });
    await A.evaluate(() => window.dispatchEvent(new Event("focus")));   // what a Realtime ping / coming back to the tab does
    await A.waitForTimeout(500);                                            // refresh has gone out (350 ms timer), answer not back
    await A.click('#pointsTrack button[data-act="od"][data-v="O"]');      // captain taps O for Pt 1 (saves fast)
    await A.waitForTimeout(400);
    const server1 = be.point("p1").outcomes[0]?.start_on;
    const shownSoon = await A.$eval('#pointsTrack button[data-act="od"][data-v="O"]', e => e.getAttribute("aria-pressed"));
    await A.waitForTimeout(2600);                                           // the old app_load answer lands
    const shownLater = await A.$eval('#pointsTrack button[data-act="od"][data-v="O"]', e => e.getAttribute("aria-pressed"));
    H.report("Old refresh answer overwrites a saved tap on screen", server1 === "O" && shownSoon === "true" && shownLater === "false",
      `server start_on=${server1}; O pressed right after tap=${shownSoon}; O pressed after the slow refresh landed=${shownLater}`);
    // The captain sees O not selected and taps it again (only if it really looks unselected).
    be.net("app_load", null);
    if (shownLater === "true") { H.report("Re-tapping O then clears it on the server (toggle applied to the newer copy)", false, "O still shows selected, so there's no reason to tap again"); return; }
    await A.click('#pointsTrack button[data-act="od"][data-v="O"]');
    await A.waitForTimeout(1500);
    const final = be.point("p1").outcomes[0]?.start_on;
    const shownFinal = await A.$eval('#pointsTrack button[data-act="od"][data-v="O"]', e => e.getAttribute("aria-pressed"));
    H.report("Re-tapping O then clears it on the server (toggle applied to the newer copy)", final === "",
      `server start_on after 2nd tap="${final}", O shown pressed=${shownFinal}, calls: ${be.log.filter(e => e.board === "A").map(e => e.fn + (e.error ? "(" + e.error + ")" : "")).join(", ")}`);
    console.log("page errors:", A.errors || []);
  } finally { await browser.close(); server.stop(); }
})();
