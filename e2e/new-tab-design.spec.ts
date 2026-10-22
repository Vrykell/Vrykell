import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`new tab picker follows the profile and location layout in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await page.getByTestId('tab-new-btn').click();
  const dialog = page.getByRole('dialog', { name: '新建标签页' });
  await expect(dialog.getByTestId('new-tab-default')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '选择配置文件' })).toBeVisible();
  await expect(dialog.getByTestId('new-tab-option-shell:zsh')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '打开位置' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '在当前目录打开' })).toHaveAttribute('data-active', 'true');
  await dialog.getByRole('button', { name: '在用户主目录打开' }).click();
  await expect(dialog.getByRole('button', { name: '在用户主目录打开' })).toHaveAttribute('data-active', 'true');
  await expect(dialog.getByRole('heading', { name: '高级' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '拆分标签页' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '更多配置文件…' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '在新窗口中打开' })).toHaveCount(0);
  await expect(dialog.getByTestId('new-tab-option-shell:zsh')).toHaveClass(/workspace-floating-row/);
  expect((await dialog.boundingBox())!.height).toBeLessThan(600);
  await page.screenshot({ path: info.outputPath(`new-tab-${theme}.png`), animations: 'disabled' });
});
