import { expect, test } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';

for (const mode of ['dark', 'light'] as const) test(`sidebar hairline blends with the ${mode} preset and retains resize feedback`, async ({ page }, info) => {
  await setupTauriMock(page);
  await page.addInitScript(mode => {
    const presets = { darkPreset: 'nord-dark', lightPreset: 'catppuccin-latte' };
    localStorage.setItem('vrykell-theme-mode', mode);
    localStorage.setItem('vrykell-theme-presets', JSON.stringify(presets));
    localStorage.setItem('e2e-theme-config', JSON.stringify({ ...presets, opacity: 1, backgroundImage: null, vars: {} }));
  }, mode);
  await page.goto('/'); await waitForWorkbench(page);
  await page.locator('[data-dock-btn="chat"]').click();
  const handle = page.getByTestId('resize-handle-chat');
  await expect(handle).toBeVisible();
  const line = handle.locator(':scope > div');
  const alpha = () => line.evaluate(element => Number(getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.[3] ?? 1));
  await page.mouse.move(10, 10);
  await expect.poll(alpha).toBeLessThanOrEqual(0.1);
  expect((await line.boundingBox())!.width).toBe(1);
  await handle.hover(); await expect.poll(alpha).toBe(1);
  await page.mouse.move(10, 10); await expect.poll(alpha).toBeLessThanOrEqual(0.1);
  await page.screenshot({ path: info.outputPath(`sidebar-${mode}.png`) });
});
