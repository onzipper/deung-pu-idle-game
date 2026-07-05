/* Dev-only: screenshot /proto with console/error capture. node scripts/proto-shot.mjs [outDir]
 * Round 2: 3 gear-tier buttons (ธรรมดา/หายาก/ระดับเทพ) replace round 1's
 * pixel-mode toggle + 4 aura-tier buttons. */
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
await new Promise((r) => setTimeout(r, 1500));

// Default mount is gear tier 3 (ระดับเทพ) — capture it first.
await page.screenshot({ path: `${out}/proto-tier3.png` });

const buttons = await page.$$("button");
// Button order matches GEAR_TIERS: [0]=ธรรมดา, [1]=หายาก, [2]=ระดับเทพ
if (buttons[0]) await buttons[0].click();
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${out}/proto-tier1.png` });

if (buttons[1]) await buttons[1].click();
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${out}/proto-tier2.png` });

if (buttons[2]) await buttons[2].click();
// Let the tier-3 weapon aura run a while so flame/sparkle/crackle are all
// visibly mid-flight in the shot, plus a mid-swing catch.
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/proto-tier3-blazing.png` });

console.log(logs.length ? logs.join("\n") : "(no console messages)");
await browser.close();
