import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`uses the existing launcher design and one tab toolbar in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(value => { localStorage.setItem('vrykell-theme-mode', value); localStorage.setItem('vrykell-startup-mode', 'empty'); }, theme); await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const start = page.getByTestId('unified-start-page'); await expect(start.locator('.ai-launch-title')).toHaveText('聚合工作区');
  await expect(start.locator('.ai-launchpad')).toBeVisible();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(start.getByRole('button', { name: '新建文件', exact: true })).toBeInViewport();
    const actions = (await start.locator('.ai-launch-body > .ai-launch-agents').nth(2).boundingBox())!;
    expect(actions.height).toBeGreaterThan(28);
    await page.screenshot({ path: info.outputPath(`unified-start-${theme}-${width}.png`) });
  }
  await start.getByRole('button', { name: '新建文件', exact: true }).click();
  const mixed = page.getByTestId('unified-workspace'); await expect(mixed.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '保存文件', exact: true })).toBeVisible();
  await expect(mixed.locator('.folder-header')).toHaveCount(0);
  await expect(start).toHaveCount(0);
});
