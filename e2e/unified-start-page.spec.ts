import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light'])
  test(`uses the shared start page and one tab toolbar in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript((value) => {
      localStorage.setItem('vrykell-theme-mode', value);
      localStorage.setItem('vrykell-startup-mode', 'empty');
    }, theme);
    await page.goto('/');
    await page.getByTestId('workspace-area-unified').click();
    const start = page.getByTestId('unified-start-page');
    await expect(start.getByRole('heading', { level: 2 })).toHaveText('聚合工作区');
    for (const width of [1240, 760]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(start.getByRole('button', { name: '新建文件', exact: true })).toBeInViewport();
      const buttons = start.getByRole('button');
      await expect(buttons).toHaveCount(6);
      for (const button of await buttons.all()) {
        const size = await button.evaluate((element) => ({
          height: element.clientHeight,
          width: element.clientWidth,
          content: element.scrollWidth,
        }));
        expect(size.height).toBeLessThanOrEqual(30);
        expect(size.content).toBeLessThanOrEqual(size.width + 1);
      }
      await page.screenshot({ path: info.outputPath(`unified-start-${theme}-${width}.png`) });
    }
    await start.getByRole('button', { name: '新建文件', exact: true }).click();
    const mixed = page.getByTestId('unified-workspace');
    await expect(mixed.locator('.monaco-editor')).toBeVisible();
    await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '保存文件', exact: true })).toBeVisible();
    await expect(mixed.locator('.folder-header')).toHaveCount(0);
    await expect(start).toHaveCount(0);
  });

test('keeps the English start actions on one line', async ({ page }, info) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-startup-mode', 'empty');
    localStorage.setItem('vrykell-language', JSON.stringify({ state: { preference: 'en' }, version: 0 }));
  });
  await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const start = page.getByTestId('unified-start-page');
  const buttons = start.getByRole('button');
  await expect(buttons).toHaveCount(6);
  await expect(start.getByRole('button', { name: 'New conversation' })).toHaveText('New chat');
  await expect(start.getByRole('button', { name: 'Connect a server' })).toHaveText('Connect');
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    for (const button of await buttons.all()) {
      const size = await button.evaluate((element) => ({
        height: element.clientHeight,
        width: element.clientWidth,
        content: element.scrollWidth,
      }));
      expect(size.height).toBeLessThanOrEqual(30);
      expect(size.content).toBeLessThanOrEqual(size.width + 1);
    }
    await page.screenshot({ path: info.outputPath(`unified-start-en-${width}.png`) });
  }
});
