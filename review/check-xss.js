// Typed names with HTML/JS payloads, shown on every page and sheet. Fails if any payload runs.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"]];
const X = n => `"><img src=x onerror="window.__xss=(window.__xss||[]).concat('${n}')">'<svg onload=window.__xss=1>`;
(async () => {
  const server = await H.startServer(8789);
  const browser = await H.chromium.launch();
  try {
    const d = H.seed({ lineups: L });
    d.players[0].nick = X("nick").slice(0, 300); d.players[0].name = X("name");
    d.players[2].nick = ""; d.players[2].name = X("name2");
    d.games[0].name = X("game"); d.tournaments[0].name = X("tour"); d.tournaments[0].location = X("loc");
    d.tournaments.push({ id: "t0", name: X("pasttour"), start_date: "2026-01-10", location: X("loc2"), late: ["w3"], away: [] });
    d.points[0].outcomes = [{ start_on: "O", result: "us", scorer: "w0", assist: "w2" }];
    d.practices = [{ id: "pr1", practice_date: H.todayISO(), attended: ["w0", "w2"], note: X("note") }];
    d.team.pods = [{ id: "pod1", name: X("pod"), ids: ["w0", "w2"] }];
    const be = H.makeBackend(d);
    const A = await H.openBoard(browser, be, server, { name: "A" });
    const visit = [];
    const go = async (label, fn) => { try { await fn(); await A.waitForTimeout(250); visit.push(label); } catch (e) { visit.push(label + "(skipped: " + e.message.split("\n")[0] + ")"); } };
    await go("points", async () => {});
    await go("swap sheet", async () => { await A.click('#pointsTrack button.who[data-act="pick-slot"]'); });
    await go("close", async () => { await A.click('#sheet-root button[data-act="close"]'); });
    await go("played line", async () => { await A.click('button[data-act="go-line"][data-dir="-1"]'); });
    await go("copy line", async () => { await A.click('#pointsTrack button[data-act="point-menu"]'); await A.click('button[data-act="pm-copy"]'); });
    await go("game menu", async () => { await A.click('button[data-act="game-menu"]'); });
    await go("fill sheet", async () => { await A.click('#sheet-root button[data-act="fill-open"]'); await A.click('#sheet-root button[data-act="fill-pairing"][data-v="usual"]'); });
    await go("who's going", async () => { await A.click('#sheet-root button[data-act="close"]'); await A.click('button[data-act="game-menu"]'); await A.click('#sheet-root button[data-act="late-open"]'); });
    await go("new player sheet", async () => { await A.click('#sheet-root button[data-act="np-open"]'); await A.fill("#npName", "img"); });
    await go("games sheet", async () => { await A.click('#sheet-root button[data-act="close"]'); await A.click('button[data-act="games"]'); });
    await go("edit game", async () => { await A.click('#sheet-root button[data-act="close"]'); await A.click('button[data-act="game-menu"]'); await A.click('#sheet-root button[data-act="edit-game"]'); });
    for (const t of ["home", "practice", "stats", "roster"]) await go(t, async () => { await A.click('#sheet-root button[data-act="close"]').catch(() => {}); await A.click(`.bottom-nav button[data-tab="${t}"]`); });
    await go("player sheet", async () => { await A.click('button[data-act="p-edit"]'); });
    await go("tournament page", async () => { await A.click('#sheet-root button[data-act="close"]'); await A.click('.bottom-nav button[data-tab="home"]'); await A.click("button.sched-row"); });
    await go("edit tournament", async () => { await A.click('button[data-act="home-edit-tour"]'); await A.click('#sheet-root button[data-act="tour-del"]'); });
    await go("practice open", async () => { await A.click('#sheet-root button[data-act="close"]'); await A.click('.bottom-nav button[data-tab="practice"]'); await A.click('button[data-act="pr-new"]'); await A.click('button[data-act="scrim-make"]'); });
    await go("edit lines", async () => { await A.click('.bottom-nav button[data-tab="points"]'); await A.click('button[data-act="game-menu"]'); await A.click('#sheet-root button[data-act="edit-lines"]'); });
    const ran = await A.evaluate(() => window.__xss || null);
    const injected = await A.evaluate(() => document.querySelectorAll("#app img[src='x'], #sheet-root img[src='x'], svg[onload]").length);
    H.report("Script from a typed name runs somewhere", !!ran || injected > 0, { ran, injectedElements: injected, visited: visit.join(", ") });
  } finally { await browser.close(); server.stop(); }
})();
