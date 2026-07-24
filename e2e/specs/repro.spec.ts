import { test } from '@playwright/test';

const SHOTS = 'e2e/shots';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="terminal-view"]');
  // Wait for the shell prompt to appear
  await page.waitForTimeout(1500);
});

test('repro: shell usage, resize, vim enter/exit', async ({ page }) => {
  const view = page.locator('[data-testid="terminal-view"]');
  await view.click();

  // 1. Plain shell usage
  await page.keyboard.type('echo hello-world-1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ls -la | head -5');
  await page.keyboard.press('Enter');
  await page.keyboard.type('echo hello-world-2');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/1-shell.png` });

  // 2. Shrink window
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/2-shrunk.png` });

  // 3. Expand window
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/3-expanded.png` });

  // 4. vim enter (alt screen)
  await page.keyboard.type('vim /tmp/e2e-vim-test.txt');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/4-vim.png` });

  // 5. vim exit — shell must be restored exactly
  await page.keyboard.press('Escape');
  await page.keyboard.type(':q!');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/5-after-vim.png` });
});
