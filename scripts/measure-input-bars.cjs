/**
 * measure-input-bars.cjs — 用 Playwright + 缓存的 Chromium 加载 harness 页，
 * 读取两条输入栏的实测高度并打印。用法：node scripts/measure-input-bars.cjs
 * 也可传 URL 参数测量任意页面：node scripts/measure-input-bars.cjs http://localhost:1420/
 */

const path = require('path');
const { chromium } = require('playwright');

const CHROMIUM_PATH = path.join(
  require('os').homedir(),
  'Library/Caches/ms-playwright/chromium-1140/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
);

const url = process.argv[2] || 'http://localhost:1420/harness.html';

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#result', { timeout: 15000 });
  console.log(await page.textContent('#result'));
  await page.screenshot({ path: '/tmp/harness.png', fullPage: true });
  await browser.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
