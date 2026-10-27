import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('keeps modal command and search input inside the status row', async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.getByTestId('workspace-area-code').click();
  await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('menuitemradio', { name: 'Vim 模式', exact: true }).click();
  await expect(editor.locator('.code-editor-vim-status')).toContainText('NORMAL');
  for (const width of [1240, 640]) {
    await page.setViewportSize({ width, height: 800 });
    for (const command of [':set ignorecase', '/search text']) {
      await editor.locator('textarea.inputarea').focus();
      await page.keyboard.type(command);
      const input = editor.getByRole('textbox', { name: 'Vim 命令' });
      await expect(input).toHaveValue(command.slice(1));
      const status = editor.locator('.code-editor-status');
      expect(await input.evaluate(element => getComputedStyle(element).fontSize)).toBe(await status.evaluate(element => getComputedStyle(element).fontSize));
      expect(await input.evaluate(element => getComputedStyle(element).fontFamily)).toBe(await status.evaluate(element => getComputedStyle(element).fontFamily));
      const bounds = await input.boundingBox();
      const row = await editor.locator('.code-editor-status').boundingBox();
      expect(bounds).not.toBeNull(); expect(row).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(24);
      expect(bounds!.y).toBeGreaterThanOrEqual(row!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(row!.y + row!.height);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(row!.x + row!.width);
      expect(await input.evaluate(element => {
        const input = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.overflowY === 'hidden' || style.overflowY === 'clip') {
            const bounds = parent.getBoundingClientRect();
            if (input.y < bounds.y || input.bottom > bounds.bottom) return false;
          }
        }
        return true;
      })).toBe(true);
      await page.screenshot({ path: info.outputPath(`command-${width}-${command[0] === ':' ? 'ex' : 'search'}.png`) });
      await page.keyboard.press('Escape');
      await expect(input).toHaveCount(0);
      await expect(editor.locator('.code-editor-status')).toContainText('UTF-8');
    }
  }
});
