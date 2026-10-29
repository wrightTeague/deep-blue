// The next question appears exactly where the result buttons were, so a nervous double tap
// answers it: "We scored" x2 picks a scorer; "They scored" x2 on a 2-point line records both points.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8779);
  const browser = await H.chromium.launch();
  try {
    for (const [v, plays] of [["us", 1], ["them", 2]]) {
      const d = H.seed({ lineups: L }); d.points[0].plays = plays;
      const be = H.makeBackend(d);
      const A = await H.openBoard(browser, be, server, { name: "A" + v });
      const b = await A.$(`#pointsTrack button[data-act="result"][data-v="${v}"]`);
      const box = await b.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      await A.touchscreen.tap(x, y);
      await A.waitForTimeout(150);
      const under = await A.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y)?.closest("button"); return el ? `${el.dataset.act} ${el.textContent.trim()}` : null; }, [x, y]);
      await A.touchscreen.tap(x, y);
      await A.waitForTimeout(1500);
      const o = be.point("p1").outcomes;
      if (v === "us") H.report("Double tap 'We scored' also records a scorer", !!(o[0] && o[0].scorer), `under the finger after tap 1: "${under}"; server: ${JSON.stringify(o)}`);
      else H.report("Double tap 'They scored' on a 2-point line turns off the auto 'start on O' for Pt 2", o[0].result === "them" && o[1] && o[1].start_on === "", `under the finger after tap 1: "${under}"; server: ${JSON.stringify(o.map(x => ({ result: x.result, start_on: x.start_on })))} (a single tap leaves Pt 2 on O)`);
    }
  } finally { await browser.close(); server.stop(); }
})();
