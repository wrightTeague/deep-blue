// Every page and sheet at 390 px wide with the longest names the inputs allow (nickname 30,
// game / tournament / location 80). Reports horizontal page overflow and elements sticking out.
const H = require("./harness");
const SP = process.env.SP || require("path").join(__dirname, "shots");   // screenshots (git-ignored)
require("fs").mkdirSync(SP, { recursive: true });
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8783);
  const browser = await H.chromium.launch();
  try {
    const d = H.seed({ lineups: L });
    const long = ["Bartholomew-Christopherson Jr", "Maximiliana Wolfeschlegelst", "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW"];
    d.players[2].nick = long[0]; d.players[11 + 4].nick = long[1]; d.players[0].nick = long[2];
    d.games[0].name = "vs Swarthmore Earthworms (pool play, round 3, field 12 by the parking lot)".slice(0, 80);
    d.tournaments[0].name = "Philadelphia Fall Invitational Open Division Pool Play Weekend Championship 2026".slice(0, 80);
    d.tournaments[0].location = "Wissahickon Valley Park, Fields 9 through 14, behind the high school".slice(0, 80);
    d.points[0].outcomes = [{ start_on: "O", result: "us", scorer: "w2", assist: "m4" }];
    const be = H.makeBackend(d);
    const A = await H.openBoard(browser, be, server, { name: "A", sharks: true, ascii: true });
    const check = async label => {
      await A.waitForTimeout(350);
      const r = await A.evaluate(() => {
        const W = window.innerWidth, out = [];
        document.querySelectorAll("body *").forEach(el => {
          const b = el.getBoundingClientRect(); if (!b.width || b.right <= W + 1) return;
          // ignore things clipped by an overflow:hidden ancestor
          for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(cs.overflowX) && p.getBoundingClientRect().right <= W + 1) return; }
          out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(b.right)}`);
        });
        return { sw: document.documentElement.scrollWidth, W, out: [...new Set(out)].slice(0, 6) };
      });
      const bad = r.sw > r.W || r.out.length;
      console.log(`${bad ? "OVERFLOW" : "ok      "} ${label}: scrollWidth=${r.sw}${r.out.length ? " | " + r.out.join(" ; ") : ""}`);
      await A.screenshot({ path: `${SP}/l390-${label.replace(/\W+/g, "_")}.png` });
    };
    await check("points");
    await A.click('button[data-act="go-line"][data-dir="-1"]'); await check("points line 1 (played)");
    for (const t of ["home", "practice", "stats", "roster"]) { await A.click(`.bottom-nav button[data-tab="${t}"]`); await check(t); }
    await A.click('.bottom-nav button[data-tab="home"]'); await A.click('button.sched-row'); await check("tournament page");
    await A.click('.bottom-nav button[data-tab="points"]');
    const sheets = [["game menu", 'button[data-act="game-menu"]'], ["fill sheet", '#sheet-root button[data-act="fill-open"]']];
    await A.click(sheets[0][1]); await check(sheets[0][0]); await A.click(sheets[1][1]); await check(sheets[1][0]); await A.click('#sheet-root button[data-act="close"]');
    await A.click('button[data-act="game-menu"]'); await A.click('#sheet-root button[data-act="late-open"]'); await check("who's going sheet"); await A.click('#sheet-root button[data-act="close"]');
    await A.click('#pointsTrack button.who[data-act="pick-slot"]'); await check("player picker"); await A.click('#sheet-root button[data-act="close"]');
    await A.click('#pointsTrack button[data-act="point-menu"]'); await check("line menu"); await A.click('#sheet-root button[data-act="close"]');
    await A.click('button[data-act="games"]'); await check("games list"); await A.click('#sheet-root button[data-act="close"]');
    await A.click('button[data-act="game-menu"]'); await A.click('#sheet-root button[data-act="edit-lines"]'); await check("edit lines");
  } finally { await browser.close(); server.stop(); }
})();
