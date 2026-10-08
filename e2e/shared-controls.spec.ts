import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('composer controls share permission state, theme overrides and concise hover hints', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: '切换到 AI 模式', exact: true }).first().click();
  const permission = page.getByTestId('permission-mode-button').first();
  await expect(permission).toHaveAccessibleName('标准权限');
  await permission.hover();
  const tooltip = page.getByTestId('app-tooltip');
  await expect(tooltip).toContainText('按工具设置判定。');
  expect(await tooltip.textContent()).not.toMatch(/[；;（）]/);
  await permission.click();
  await expect(permission).toHaveAccessibleName('严格权限');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.getByTestId('permission-mode-button')).toHaveCount(1);
  await expect(page.getByTestId('permission-mode-button').last()).toHaveAccessibleName('严格权限');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--icon-color', '#abcdef');
    document.documentElement.style.setProperty('--control-hover-bg', '#334455');
    document.documentElement.style.setProperty('--icon-hover-color', '#ffffff');
  });
  const attachment = page.getByRole('button', { name: '添加附件', exact: true }).last();
  await attachment.hover();
  await expect(attachment).toHaveCSS('background-color', 'rgb(51, 68, 85)');
  await expect(attachment).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '切换到 AI 模式', exact: true }).first().click();
  await expect(page.getByTestId('permission-mode-button')).toHaveAccessibleName('严格权限');
  const send = page.getByRole('button', { name: '发送', exact: true });
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute('data-tip-shortcut', 'Enter');
});

test('settings use concise explanations and icon badges for completion keys', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '模型行为');
  await expect(page.locator('.settings-completion-keys [data-key-icon="Tab"]')).toBeVisible();
  await expect(page.locator('.settings-completion-keys [data-key-icon="Escape"]')).toBeVisible();
  await expect(page.getByText('每个工具结果的字符上限。', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('shared-controls-settings.png') });
});

test('edge tooltips keep their label and shortcut on one line in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).hover();
  const tooltip = page.getByTestId('app-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('.app-tooltip-copy > span')).toHaveText('打开设置');
  await expect(tooltip.locator('[data-key-icon]')).not.toHaveCount(0);
  const label = await tooltip.locator('.app-tooltip-copy > span').boundingBox();
  const bubble = await tooltip.boundingBox();
  expect(label!.height).toBeLessThan(24);
  expect(bubble!.x).toBeGreaterThanOrEqual(6);
  expect(bubble!.x + bubble!.width).toBeLessThanOrEqual(494);
});
