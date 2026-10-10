import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('settings navigation has static headings and save feedback appears once then disappears', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await gotoSetting(page, '模型配置');
  const nav = page.locator('aside');
  await expect(nav.locator('.settings-nav-heading')).toHaveCount(6);
  await expect(nav.getByRole('button')).toHaveCount(16);
  await expect(nav.locator('[aria-expanded]')).toHaveCount(0);
  await expect(nav.getByRole('button').locator('svg')).toHaveCount(16);
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByPlaceholder('模型名称').first().fill('One summary');
  await page.getByPlaceholder('服务地址 (Base URL)').first().fill('https://example.test/v1');
  await expect(page.getByRole('status')).toHaveCount(1);
  await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
  await expect(page.getByRole('status')).toHaveCount(0);
  await nav.getByRole('button', { name: '主题', exact: true }).press('Enter');
  await expect(nav.getByRole('button', { name: '主题', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button', { name: '主题', exact: true })).toHaveCSS('outline-style', 'none');
  await nav.locator('.scroll-region').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath('static-settings-navigation.png') });
});
