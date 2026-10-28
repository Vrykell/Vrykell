import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('settings dropdown supports keyboard selection, cancellation and theme colors', async ({ page, browserName }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '字体与显示');
  await expect(page.locator('.settings-content select')).toHaveCount(0);
  const trigger = page.getByRole('combobox', { name: '页面字号' });
  await trigger.press('ArrowDown');
  const menu = page.getByRole('listbox', { name: '页面字号' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', { name: '13px', exact: true })).toHaveAttribute('aria-selected', 'true');
  await trigger.press('End');
  await trigger.press('Escape');
  await expect(trigger).toHaveText('13px');
  await expect(trigger).toBeFocused();
  await trigger.press('ArrowDown');
  await trigger.press('ArrowDown');
  await trigger.press('Enter');
  await expect(trigger).toHaveText('14px');
  await trigger.click();
  await page.locator('.settings-page-header h1').click();
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: '恢复默认字体设置' }).click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveText('13px');
  const colors: string[] = [];
  const surface = page.locator('.ui-select-menu');
  for (const theme of ['深色', '浅色']) {
    await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
    await page.getByRole('radio', { name: `始终${theme}`, exact: true }).click();
    await page.locator('aside').getByRole('button', { name: '字体与显示', exact: true }).click();
    await trigger.click();
    // The floating surface carries the background; the listbox inside only scrolls.
    const surface = page.locator('.ui-select-menu');
    const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--elevated').trim());
    await expect(surface).toHaveCSS('background-color', await page.evaluate(color => {
      const sample = document.createElement('div');
      sample.style.color = color;
      document.body.appendChild(sample);
      const result = getComputedStyle(sample).color;
      sample.remove();
      return result;
    }, background));
    colors.push(await surface.evaluate(element => getComputedStyle(element).backgroundColor));
    await page.screenshot({ path: test.info().outputPath(`select-${theme}.png`) });
    await trigger.press('Escape');
  }
  expect(colors[0]).not.toBe(colors[1]);
  await trigger.click();
  // The native engine uses the full-navigation modifier for button tab stops.
  await trigger.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '终端字号' })).toBeFocused();
});

test('long dropdown stays within a small viewport and scrolls to keyboard selection', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '字体与显示');
  await page.setViewportSize({ width: 680, height: 520 });
  const trigger = page.getByRole('combobox', { name: '终端字号' });
  await trigger.click();
  const menu = page.getByRole('listbox', { name: '终端字号' });
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(672);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(512);
  const id = await menu.getAttribute('id');
  const bar = page.locator(`[role="scrollbar"][aria-controls="${id}"]`);
  await expect(bar).toBeVisible();
  const thumb = (await bar.locator('.overlay-scrollbar-thumb').boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + 160, { steps: 6 });
  await page.mouse.up();
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await trigger.press('End');
  await expect(menu.getByRole('option', { name: '24px', exact: true })).toBeInViewport();
  await trigger.press('Enter');
  await expect(trigger).toHaveText('24px');
});
