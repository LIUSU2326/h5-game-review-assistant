import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = process.cwd();
const input = path.join(root, "workbench", "index.html");
const output = path.join(root, "workbench", "preview.png");

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.goto(pathToFileURL(input).href, { waitUntil: "domcontentloaded", timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: output, fullPage: false });
await browser.close();
console.log(output);
