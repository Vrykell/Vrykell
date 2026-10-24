import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`uses the existing launcher design and one tab toolbar in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(value => localStorage.setItem('vrykell-theme-mode', value), theme); await page.goto('/');
  const terminal = await page.locator('.terminal-pane').first().elementHandle();
  await page.getByTestId('workspace-area-unified').click();
  const start = page.getByTestId('unified-start-page'); await expect(start.locator('.ai-launch-title')).toHaveText('聚合工作区');
  await expect(start.locator('.ai-launchpad')).toBeVisible();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(start.getByRole('button', { name: '新建文件', exact: true })).toBeInViewport();
    const actions = (await start.locator('.ai-launch-body > .ai-launch-grid').boundingBox())!;
    const resources = (await start.getByRole('region', { name: '已打开的工作资源' }).boundingBox())!;
    expect(resources.y - actions.y - actions.height).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: info.outputPath(`unified-start-${theme}-${width}.png`) });
  }
  await start.getByRole('button', { name: '新建文件', exact: true }).click();
  const mixed = page.getByTestId('unified-workspace'); await expect(mixed.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '保存文件', exact: true })).toBeVisible();
  await expect(mixed.locator('.folder-header')).toHaveCount(0);
  expect(await terminal!.evaluate(element => element.isConnected)).toBe(true);
});
