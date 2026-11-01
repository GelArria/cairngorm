import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../logs/e2e/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const modes = ["chat", "calendar"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:1420");
await page.waitForSelector('[data-testid="sidebar"]', { timeout: 20000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, "01-chat.png") });
console.log("shot 01-chat");

let i = 2;
for (const mode of modes.slice(1)) {
  await page.click(`[data-testid="mode-${mode}"]`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${String(i).padStart(2, "0")}-${mode}.png`) });
  console.log(`shot ${String(i).padStart(2, "0")}-${mode}`);
  i++;
}

await browser.close();
console.log("DONE", OUT);
