// After the team passcode is changed on another phone, a tap on a line hits bad_code, renderGate()
// shows the passcode screen... and patchPoint's finally{} immediately render()s the board back
// over it. The phone stays on a board where nothing saves and no message is shown.
const H = require("./harness");
const L = [["w0","m0","w2","m4","w5","m8","m11"], ["w1","m1","w3","m5","w6","m9","m12"]];
(async () => {
  const server = await H.startServer(8791);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed({ lineups: L }));
    const A = await H.openBoard(browser, be, server, { name: "A" });
    // Simulate the passcode change: the fake server now rejects A's (old) code.
    await A.route("**/rest/v1/rpc/**", r => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "bad_code" }) }));
    await A.click('#pointsTrack button[data-act="result"][data-v="them"]');
    await A.waitForTimeout(800);
    const gate = await A.$("#gateForm"), board = await A.$("#pointsTrack");
    const score = await A.$eval(".score b", e => e.textContent).catch(() => null);
    await A.waitForTimeout(1500);
    const gateLater = !!(await A.$("#gateForm"));
    H.report("Passcode screen is replaced by the board right away; the tap silently reverts", !gate && !!board,
      `passcode form visible: ${!!gate}; board visible: ${!!board}; score shown: ${score} (the "They scored" was dropped); passcode form 2.3 s later: ${gateLater}; toast: "${await A.$eval("#toast", e => e.hidden ? "" : e.textContent)}"`);
  } finally { await browser.close(); server.stop(); }
})();
