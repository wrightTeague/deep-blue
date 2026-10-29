const H = require("./harness");
(async () => {
  const server = await H.startServer();
  const browser = await H.chromium.launch();
  try {
    const L = [["w0","m0","w2","m4","w5","m8","m11"],["w1","m1","w3","m5","w6","m9","m12"]];
    const be = H.makeBackend(H.seed({ lineups: L }));
    const page = await H.openBoard(browser, be, server);
    console.log("sync:", await page.$eval("#sync", e => e.className));
    console.log("names:", await H.lineNames(page));
    console.log("rpcs:", be.log.map(e => e.fn));
    await page.screenshot({ path: process.env.SP + "/smoke.png", fullPage: false });
    console.log("errors:", page.errors || []);
  } finally { await browser.close(); server.stop(); }
})();
