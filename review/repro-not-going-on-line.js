// Marking someone "not going" (or Out) leaves them on every line already planned, with no warning,
// and Fill lines doesn't take them off full lines - although the sheet says lines leave them out.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"],["w1","m1","w3","m5","w6","m9","m12"],["w4","m2","w7","m3","w8","m6","m10"]];
(async () => {
  const server = await H.startServer(8775);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    await A.click('button[data-act="game-menu"]');
    await A.click('button[data-act="late-open"]');
    const note = await A.$eval("#sheet-root .note", e => e.textContent);
    await A.click('button[data-act="late-mark"][data-p="w2"]'); await A.waitForTimeout(300);   // Cleo: late
    await A.click('button[data-act="late-mark"][data-p="w2"]'); await A.waitForTimeout(600);   // Cleo: not going
    await A.click('#sheet-root button[data-act="close"]');
    console.log("sheet says:", note.trim().slice(0, 120));
    console.log("server away:", be.db.tournaments[0].away);
    const names = await H.lineNames(A);
    const card = await A.$eval("#pointsTrack .point", e => e.textContent.replace(/\s+/g, " "));
    console.log("Line 1 shows:", names.join(", "));
    // Fill lines, "Also fill empty spots" on, 0 new lines.
    await A.click('button[data-act="game-menu"]');
    await A.click('#sheet-root button[data-act="fill-open"]');
    await A.click('button[data-act="fill-n"][data-v="0"]');
    await A.click('button[data-act="fill-go"]');
    await A.waitForTimeout(800);
    const toast = await A.$eval("#toast", e => e.hidden ? "" : e.textContent);
    const still = be.point("p1").lineup.some(s => s.p === "w2");
    H.report("Not-going player stays on Line 1; no warning; Fill leaves her there", still && names.includes("Cleo") && !/not going/i.test(card),
      `Cleo on server Line 1: ${still}; Fill toast: "${toast}"`);
    // The chart under the lines quietly drops her, so the line and the chart disagree.
    const chart = await A.$eval(".ppl", e => e.textContent.replace(/\s+/g, " ")).catch(() => "");
    console.log("chart:", (chart.match(/Planned this game, all \d+ players/) || [""])[0], "(24 active)");
  } finally { await browser.close(); server.stop(); }
})();
