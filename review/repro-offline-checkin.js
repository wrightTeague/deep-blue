// With no signal, practice check-ins (and every other non-line save) stay ticked on screen after
// "Couldn't save", because the reload that should undo them also fails. When signal comes back the
// next reload silently unticks them all. Nothing is retried.
const H = require("./harness");
(async () => {
  const server = await H.startServer(8782);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed());
    const A = await H.openBoard(browser, be, server, { name: "A", store: { tab: "practice" } });
    await A.click('button[data-act="pr-new"]'); await A.waitForTimeout(600);
    be.net("*", { fail: true });                                   // walked out of signal
    for (const id of ["w3", "w4", "m5", "m6"]) { await A.click(`button[data-act="pr-mark"][data-p="${id}"]`); await A.waitForTimeout(250); }
    await A.waitForTimeout(4000);                                  // toasts gone
    const shown = await A.$eval(".here .big", e => +e.textContent);
    const sync = await A.$eval("#sync", e => e.className);
    be.net("*", null);                                             // signal back
    await A.evaluate(() => window.dispatchEvent(new Event("focus")));
    await A.waitForTimeout(1500);
    const after = await A.$eval(".here .big", e => +e.textContent);
    H.report("Check-ins shown while offline, then silently dropped", shown === 4 && after === 0,
      `"here" count while offline: ${shown} (header ${sync}); server attended: ${JSON.stringify(be.db.practices[0].attended)}; after signal returns: ${after}`);
  } finally { await browser.close(); server.stop(); }
})();
