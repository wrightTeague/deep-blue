// Swipe between line cards with real touch events (CDP), and what happens to a live update that
// arrives mid-swipe when a second swipe starts before the first has settled.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"], ["w4","m2","w7","m3","w8","m6","m10"]];
async function swipe(cdp, x0, y, dx, steps = 8, holdMs = 0, release = true) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + dx * i / steps, y }] }); await new Promise(r => setTimeout(r, 16)); }
  if (holdMs) await new Promise(r => setTimeout(r, holdMs));
  if (release) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const cardLine = A => A.$eval("#pointsTrack .point .ln", e => e.textContent).catch(() => "(add card)");
const mid = async A => { const b = await (await A.$("#pointsTrack > *")).boundingBox(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 260) }; };
(async () => {
  const server = await H.startServer(8786);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    const B = await H.openBoard(browser, be, server, { name: "B" });
    const cdp = await A.ctx.newCDPSession(A);
    const before = await cardLine(A);
    let m = await mid(A); await swipe(cdp, m.x + 80, m.y, -200); await A.waitForTimeout(600);
    const after = await cardLine(A);
    m = await mid(A); await swipe(cdp, m.x - 80, m.y, 200); await A.waitForTimeout(600);
    console.log("sanity:", "Basic swipe left/right works:", before === "Line 1" && after === "Line 2" && (await cardLine(A)) === "Line 1", `${before} -> ${after} -> ${await cardLine(A)}`);
    const loadsBefore = be.log.filter(e => e.board === "A" && e.fn === "app_load").length;
    // Vertical-ish drag must scroll, not swipe.

    // Live update lands during a short (snap-back) swipe; a 2nd short swipe starts within 200 ms.
    m = await mid(A);
    await swipe(cdp, m.x, m.y, -40, 4, 0, false);          // finger down, moved 40px, still down
    await B.click('#pointsTrack button[data-act="role"][data-k="0"]');   // B sets Ava to H -> ping to A
    await A.waitForTimeout(1200);                          // A reloaded; render deferred (mid-swipe)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });   // snap back
    await A.waitForTimeout(80);
    await swipe(cdp, m.x, m.y, -40, 4);                    // second short swipe within 200 ms
    await A.waitForTimeout(1500);
    const chip = await A.$eval('#pointsTrack button[data-act="role"][data-k="0"]', e => e.textContent.trim());
    H.report("Live change from another phone never shows after two quick short swipes", chip !== "H",
      `server role=${be.point("p1").lineup[0].r}; A reloaded ${be.log.filter(e => e.board === "A" && e.fn === "app_load").length - loadsBefore}x; A's chip still shows "${chip}" 1.5 s later`);
    await A.waitForTimeout(3000);
    console.log("  4.5 s later: chip shows", await A.$eval('#pointsTrack button[data-act="role"][data-k="0"]', e => e.textContent.trim()));
    await A.click('.bottom-nav button[data-tab="points"]'); await A.waitForTimeout(300);
    console.log("  after tapping the Points tab (full redraw): chip shows", await A.$eval('#pointsTrack button[data-act="role"][data-k="0"]', e => e.textContent.trim()));
  } finally { await browser.close(); server.stop(); }
})();
