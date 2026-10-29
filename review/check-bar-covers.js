// With the Fill-lines / Copied bar showing, scroll to the very bottom of Points on a phone and see
// whether the last things on the page are hidden under the bar.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"], ["w4","m2","w7","m3","w8","m6","m10"]];
(async () => {
  const server = await H.startServer(8785);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    await A.click('#pointsTrack button[data-act="point-menu"]'); await A.click('button[data-act="pm-copy"]');
    await A.waitForTimeout(300);
    await A.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await A.waitForTimeout(400);
    const r = await A.evaluate(() => {
      const bar = document.querySelector(".clipbar").getBoundingClientRect();
      const items = [...document.querySelectorAll(".deep-in .bar-row, .deep-in .few, .deep-in .up-row")];
      const hidden = items.filter(el => { const b = el.getBoundingClientRect(); return b.bottom > bar.top + 4 && b.top < bar.bottom; }).map(el => el.textContent.replace(/\s+/g, " ").trim().slice(0, 40));
      return { barTop: Math.round(bar.top), barH: Math.round(bar.height), hidden };
    });
    await A.screenshot({ path: (process.env.SP || (require("fs").mkdirSync(require("path").join(__dirname, "shots"), { recursive: true }), require("path").join(__dirname, "shots"))) + "/bar-covers.png" });
    H.report("Bottom of the page can't be scrolled out from under the bar", r.hidden.length > 0, r);
  } finally { await browser.close(); server.stop(); }
})();
