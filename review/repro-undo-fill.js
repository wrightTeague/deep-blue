// Fill lines' Undo stays armed after the lines are played, and still works after switching games.
const H = require("./harness");
(async () => {
  const server = await H.startServer(8771);
  const browser = await H.chromium.launch();
  try {
    // --- A: Undo after playing a filled line ---
    const data = H.seed();
    data.games.push({ id: "g2", name: "vs Swarthmore", opponent: "", game_date: H.todayISO(), tournament_id: "t1", zone: {} });
    const be = H.makeBackend(data);
    const page = await H.openBoard(browser, be, server);
    await page.click('button[data-act="fill-open"]');
    await page.click('button[data-act="fill-go"]');
    await H.settle(page, 1200);
    const filled = be.gamePoints("g1");
    console.log("lines after Fill:", filled.length);
    // Play line 1 (We scored, scorer, assist) and line 2 (They scored).
    await page.click('#pointsTrack button[data-act="result"][data-v="us"]');
    await page.waitForTimeout(500);   // human pace (see REVIEW.md #12)
    await page.click('#pointsTrack button[data-act="set-goal"]');
    await page.waitForTimeout(500);   // human pace (see REVIEW.md #12)
    await page.click('#pointsTrack button[data-act="set-assist"]:not([data-p="none"])');
    await H.settle(page, 1200);
    await page.click('#pointsTrack button[data-act="result"][data-v="them"]');
    await H.settle(page, 1200);
    const played = be.gamePoints("g1").filter(p => (p.outcomes || []).some(o => o.result));
    console.log("played lines on server:", played.length, played.map(p => p.outcomes.map(o => o.result + (o.scorer ? "/" + o.scorer : "")).join(",")));
    const barText = await page.$eval(".clipbar", e => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "(no bar)");
    console.log("bottom bar still showing:", barText);
    if (await page.$('.clipbar button[data-act="auto-undo"]')) await page.click('.clipbar button[data-act="auto-undo"]');
    await H.settle(page, 1500);
    const after = be.gamePoints("g1");
    H.report("Undo after playing deletes played lines (and their goals)", played.length === 2 && after.length === 0,
      `server lines in game 1 after Undo: ${after.length}; points recorded before Undo: ${played.length}`);

    // --- B: Undo from a different game ---
    const be2 = H.makeBackend(data);
    const p2 = await H.openBoard(browser, be2, server, { name: "B" });
    await p2.click('button[data-act="fill-open"]');
    await p2.click('button[data-act="fill-go"]');
    await H.settle(p2, 1200);
    const n1 = be2.gamePoints("g1").length;
    await p2.click('button[data-act="games"]');
    await p2.click('button[data-act="pick-game"][data-id="g2"]');
    await H.settle(p2, 400);
    const title = await p2.$eval(".gh-name", e => e.textContent.trim());
    const bar2 = await p2.$eval(".clipbar", e => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "(no bar)");
    console.log(`now on "${title}", bar: ${bar2}`);
    if (await p2.$('.clipbar button[data-act="auto-undo"]')) await p2.click('.clipbar button[data-act="auto-undo"]');
    await H.settle(p2, 1500);
    H.report("Undo shown on another game deletes the first game's lines", n1 === 3 && be2.gamePoints("g1").length === 0,
      `game 1 lines before: ${n1}, after tapping Undo while viewing game 2: ${be2.gamePoints("g1").length}`);
    console.log("page errors:", page.errors || [], p2.errors || []);
  } finally { await browser.close(); server.stop(); }
})();
