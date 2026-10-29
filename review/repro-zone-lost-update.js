// Zone spots are saved as one whole object built from this phone's copy. Two captains editing
// different zone lists a moment apart: the second save puts back the first captain's old lists.
const H = require("./harness");
(async () => {
  const server = await H.startServer(8793);
  const browser = await H.chromium.launch();
  try {
    const be = H.makeBackend(H.seed());
    const A = await H.openBoard(browser, be, server, { name: "A", store: { tab: "roster" } });
    const B = await H.openBoard(browser, be, server, { name: "B", store: { tab: "roster" } });
    be.net("app_load", { board: "B", res: 3000 });
    await A.click('button[data-act="p-edit"][data-id="m12"]');                 // Max
    await A.click('button[data-act="pe-zone"][data-z="handlers"][data-v="main"]');
    await A.waitForTimeout(700);
    await B.click('button[data-act="p-edit"][data-id="w9"]');                  // Jo
    await B.click('button[data-act="pe-zone"][data-z="deep"][data-v="main"]');
    await B.waitForTimeout(4500);
    const z = be.db.team.zone;
    H.report("First captain's zone change is wiped by the second", !z.handlers.includes("m12") && z.deep.includes("w9"), `server handlers=${JSON.stringify(z.handlers)} deep=${JSON.stringify(z.deep)}`);
  } finally { await browser.close(); server.stop(); }
})();
