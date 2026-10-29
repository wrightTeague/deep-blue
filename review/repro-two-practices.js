// Two captains open today's check-in at about the same time: each phone makes its own practice for
// today, then keeps checking people into its own copy. Attendance counts two practices that day,
// with everyone only at one of them.
const H = require("./harness");
(async () => {
  const server = await H.startServer(8792);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed());
    const A = await H.openBoard(browser, be, server, { name: "A", store: { tab: "practice" } });
    const B = await H.openBoard(browser, be, server, { name: "B", store: { tab: "practice" } });
    be.net("app_load", { res: 1500 });
    await A.click('button[data-act="pr-new"]');
    await B.waitForTimeout(500);
    await B.click('button[data-act="pr-new"]');
    await A.waitForTimeout(2500);
    for (const id of ["w3", "w4", "m5"]) await A.click(`button[data-act="pr-mark"][data-p="${id}"]`);
    console.log("server practices after both taps:", JSON.stringify(be.db.practices.map(p => ({ id: p.id.slice(0, 8), date: p.practice_date }))));
    const bOpen = !!(await B.$('button[data-act="pr-mark"]'));
    console.log("B still in its check-in:", bOpen);
    if (!bOpen) await B.click('button[data-act="pr-new"]');          // B taps "Open today's check-in" again
    for (const id of ["w6", "m7", "m8"]) await B.click(`button[data-act="pr-mark"][data-p="${id}"]`);
    await A.waitForTimeout(3000);
    const today = be.db.practices.filter(p => p.practice_date === H.todayISO());
    await A.click('button[data-act="pr-close"]'); await A.waitForTimeout(300);
    const att = await A.$eval(".att-card .muted", e => e.textContent.replace(/\s+/g, " ").slice(0, 60));
    const row = await A.$eval(".att-row", e => e.textContent.replace(/\s+/g, " "));
    H.report("Two practices for today, check-ins split between them", today.length === 2,
      `${today.length} practices dated today: ${JSON.stringify(today.map(p => p.attended))}; attendance card: "${att}"; top row: "${row}"`);
  } finally { await browser.close(); server.stop(); }
})();
