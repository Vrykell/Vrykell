import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`new tab picker follows the profile and location layout in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await page.getByTestId('tab-new-btn').click();
  const dialog = page.getByRole('dialog', { name: '新建标签页' });
  await expect(dialog.getByTestId('new-tab-default')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: '选择配置文件' })).toBeVisible();
  await expect(dialog.getByTestId('new-tab-option-shell:zsh')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '打开位置' })).toBeVisible();
  await dialog.getByRole('button', { name: '在当前目录打开' }).click();
  await expect(dialog.getByRole('button', { name: '在当前目录打开' })).toHaveAttribute('data-active', 'true');
  await dialog.getByRole('button', { name: '在用户主目录打开' }).click();
  await expect(dialog.getByRole('button', { name: '在用户主目录打开' })).toHaveAttribute('data-active', 'true');
  await expect(dialog.getByRole('heading', { name: '高级' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '拆分标签页' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '更多配置文件…' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '在新窗口中打开' })).toBeVisible();
  await expect(dialog.locator('[aria-label="默认终端"]')).toBeVisible();
  await expect(dialog.getByTestId('new-tab-option-shell:zsh')).toHaveClass(/workspace-floating-row/);
  await expect(dialog.getByTestId('new-tab-option-shell:zsh')).toHaveCSS('border-top-width', '0px');
  await expect(dialog.getByTestId('new-tab-option-shell:zsh')).toHaveCSS('height', '28px');
  await expect(dialog.getByTestId('new-tab-option-ssh:ssh-1')).toHaveCSS('height', '28px');
  for (const width of [1240, 640]) {
    await page.setViewportSize({ width, height: 800 });
    // The floating surface repositions after the resize event; wait for that frame instead of
    // measuring the previous viewport on a loaded CI worker.
    await expect.poll(async () => {
      const current = await dialog.boundingBox();
      return current ? current.x + current.width : Number.POSITIVE_INFINITY;
    }, { timeout: 10_000 }).toBeLessThanOrEqual(width);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.height).toBeLessThan(700);
    await page.screenshot({ path: info.outputPath(`new-tab-${theme}-${width}.png`), animations: 'disabled' });
    await dialog.screenshot({ path: info.outputPath(`compact-menu-${theme}-${width}.png`), animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: '更多配置文件…' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '配置名称', exact: true })).toBeVisible();
});

test('profile number shortcuts create the matching terminal', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.getByTestId('tab-new-btn').click();
  const dialog = page.getByRole('dialog', { name: '新建标签页' });
  const shortcut = await dialog.getByTestId('new-tab-option-shell:bash').locator('kbd').getAttribute('aria-label');
  await page.keyboard.press(shortcut!);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-tab-row-id]').last().locator('[data-shell-mark="bash"]')).toBeVisible();
});

for (const theme of ['dark', 'light']) test(`start tab keeps its canvas color while dragging in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(() => localStorage.setItem('vrykell-startup-mode', 'empty'));
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  const start = page.locator('[data-tab-kind="start"]');
  const before = await start.evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    corner: getComputedStyle(element, '::before').backgroundColor,
  }));
  const bounds = (await start.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 65, bounds.y + 60, { steps: 6 });
  const preview = page.locator('[data-reorder-preview="item"] .folder-tab');
  await expect(preview).toBeVisible();
  const previewBounds = (await preview.boundingBox())!;
  expect(previewBounds.width).toBeCloseTo(bounds.width, 0);
  expect(previewBounds.height).toBeCloseTo(bounds.height, 0);
  expect(previewBounds.x).toBeCloseTo(bounds.x + 35, 0);
  expect(previewBounds.y).toBeCloseTo(bounds.y, 0);
  const during = await preview.evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    corner: getComputedStyle(element, '::before').backgroundColor,
  }));
  expect(during).toEqual(before);
  await page.screenshot({ path: info.outputPath(`start-drag-${theme}.png`) });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(start).toBeVisible();
});
