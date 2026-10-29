// "Who's going" on slow signal: each answer from the server is written over the screen, so an
// older answer flips the chip back, and the next tap cycles from the wrong state.
const H = require("./harness");
(async () => {
  const server = await H.startServer(8774);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed());
    const A = await H.openBoard(browser, be, server, { name: "A" });
    await A.click('button[data-act="game-menu"]');
    await A.click('button[data-act="late-open"]');
    const chip = 'button[data-act="late-mark"][data-p="w4"]';   // Eve
    const state = () => A.$eval(chip, e => e.getAttribute("aria-label"));
    be.net("app_tournament_going_mark", { board: "A", res: 1500 });
    const seen = [];
    await A.click(chip); seen.push(["tap 1", await state()]);   // going -> late
    await A.waitForTimeout(400);
    await A.click(chip); seen.push(["tap 2", await state()]);   // late -> not going
    await A.waitForTimeout(1250);                                 // answer to tap 1 lands
    seen.push(["answer 1 lands", await state()]);
    await A.click(chip); seen.push(["tap 3 (meant: back to going)", await state()]);
    await A.waitForTimeout(3500);
    const t = be.db.tournaments[0];
    const serverState = t.away.includes("w4") ? "not going" : t.late.includes("w4") ? "late" : "going";
    seen.push(["settled", await state()]);
    console.log(seen.map(([a, b]) => `${a}: ${b}`).join("\n"));
    H.report("Older answer flips the chip back and tap 3 lands on 'not going' instead of 'going'", serverState === "not going",
      `server after 3 taps: ${serverState} (going -> late -> not going -> going expected)`);
  } finally { await browser.close(); server.stop(); }
})();
