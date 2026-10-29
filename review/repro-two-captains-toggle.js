// Two captains both set Pt 1 to start on O a moment apart. The second phone's save is "stale",
// so patchPoint re-applies the *toggle* to the first phone's version and turns O off.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"],["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8773);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    const B = await H.openBoard(browser, be, server, { name: "B" });
    be.net("app_load", { board: "B", res: 3000 });   // B's live refresh is slow (bad signal)
    await A.click('#pointsTrack button[data-act="od"][data-v="O"]');
    await A.waitForTimeout(700);                     // A saved; B got the ping but its reload hasn't landed
    await B.click('#pointsTrack button[data-act="od"][data-v="O"]');
    await B.waitForTimeout(5000);
    const final = be.point("p1").outcomes[0]?.start_on;
    H.report("Two captains both tap O: point ends with no O/D", final === "", `server start_on="${final}"; B calls: ${be.log.filter(e => e.board === "B").map(e => e.fn + (e.error ? "(" + e.error + ")" : "")).join(", ")}`);
    // Same thing for the H/C role chip (cycles "" -> H -> C).
    be.net("app_load", { board: "B", res: 3000 });
    await A.click('#pointsTrack button[data-act="role"][data-k="2"]');
    await A.waitForTimeout(700);
    await B.click('#pointsTrack button[data-act="role"][data-k="2"]');
    await B.waitForTimeout(5000);
    H.report("Two captains both tap H on the same player: player ends up C", be.point("p1").lineup[2].r === "C", `server role="${be.point("p1").lineup[2].r}"`);
  } finally { await browser.close(); server.stop(); }
})();
