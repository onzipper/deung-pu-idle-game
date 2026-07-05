/* Dev-only: screenshot /proto with console/error capture. node scripts/proto-shot.mjs [outDir] */
import puppeteer from "puppeteer-core";

const out = process.argv[2] ?? ".";
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--window-size=1280,800"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto("http://localhost:3000/proto", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: `${out}/proto-pixel-on.png` });

// toggle pixel mode off (first button)
const buttons = await page.$$("button");
if (buttons[0]) await buttons[0].click();
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${out}/proto-pixel-off.png` });

// tier 3 aura
const t3 = await page.$$("button");
if (t3[4]) await t3[4].click();
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${out}/proto-tier3.png` });

console.log(logs.length ? logs.join("\n") : "(no console messages)");
await browser.close();
