import { expect, test, type Locator } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

async function expectReadableContent(content: Locator) {
  await expect.poll(() => content.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const title = content.locator('.settings-page-header h1');
  const size = await title.evaluate(element => ({ height: element.getBoundingClientRect().height, font: parseFloat(getComputedStyle(element).fontSize) }));
  expect(size.height).toBeLessThan(size.font * 2);
  const key = content.locator('input[type="password"]');
  if (await key.count()) expect((await key.boundingBox())!.width).toBeGreaterThan(140);
}

for (const theme of ['深色', '浅色']) {
  test(`settings collapse navigation completely and reveal the directory on demand in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    const navigation = page.locator('.settings-navigation');
    await navigation.getByRole('button', { name: '模型配置', exact: true }).click();
    const content = page.locator('.settings-content');
    const wide = (await navigation.boundingBox())!.width;
    expect(wide).toBe(224);

    await page.setViewportSize({ width: 900, height: 760 });
    await expect.poll(async () => (await navigation.boundingBox())!.width).toBeLessThan(wide);
    expect((await content.boundingBox())!.width).toBeGreaterThanOrEqual(480);
    await expectReadableContent(content);
    await page.screenshot({ path: testInfo.outputPath('settings-shrunk-navigation.png'), animations: 'disabled' });

    await page.setViewportSize({ width: 480, height: 760 });
    await expect(navigation).toBeHidden();
    await expect(navigation.getByRole('combobox')).toHaveCount(0);
    await expect(navigation.getByRole('textbox')).toHaveCount(0);
    const view = page.locator('.settings-view');
    const closed = (await content.boundingBox())!;
    expect(closed.x).toBe((await view.boundingBox())!.x);
    expect(closed.width).toBe((await view.boundingBox())!.width);
    await expectReadableContent(content);
    const toggle = page.getByRole('button', { name: '展开设置目录', exact: true });
    await toggle.click();
    await expect(navigation).toBeVisible();
    const opacity = await page.locator('.settings-navigation-backdrop').evaluate(element =>
      Number(getComputedStyle(element).backgroundColor.split(',').at(-1)?.replace(')', '')));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    await expect(navigation.getByRole('button', { name: '模型配置', exact: true })).toBeFocused();
    expect((await content.boundingBox())!.width).toBe(closed.width);
    await page.screenshot({ path: testInfo.outputPath('settings-open-directory.png'), animations: 'disabled' });
    await navigation.getByRole('button', { name: '模型行为', exact: true }).click();
    await expect(content.getByRole('heading', { name: '模型行为', exact: true })).toBeVisible();
    await expect(navigation).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await navigation.getByRole('button', { name: '模型配置', exact: true }).click();
    await content.evaluate(element => { element.scrollTop = 0; });
    await expectReadableContent(content);
    await page.screenshot({ path: testInfo.outputPath('settings-compact-navigation.png'), animations: 'disabled' });

    await page.setViewportSize({ width: 1240, height: 800 });
    await expect(toggle).toBeHidden();
    await expect(navigation.getByRole('button', { name: '模型配置', exact: true })).toHaveAttribute('aria-current', 'page');
    expect((await navigation.boundingBox())!.width).toBe(wide);
  });
}

test('settings adapt to dock compression and keep oversized controls horizontally accessible', async ({ page }, testInfo) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '模型配置');
  const view = page.locator('.settings-view');
  const content = page.locator('.settings-content');
  const original = (await view.boundingBox())!.width;
  await page.locator('[data-dock-btn="chat"]').click();
  const handle = page.getByTestId('resize-handle-chat');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 400, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await view.boundingBox())!.width).toBeLessThanOrEqual(560);
  await expect(page.locator('.settings-navigation')).toBeHidden();
  await expect(page.getByRole('combobox', { name: '设置页面', exact: true })).toHaveCount(0);
  await expectReadableContent(content);
  await page.screenshot({ path: testInfo.outputPath('settings-dock-compression.png'), animations: 'disabled' });
  await page.locator('[data-dock-btn="chat"]').click();
  await expect.poll(async () => (await view.boundingBox())!.width).toBe(original);
  await page.setViewportSize({ width: 360, height: 700 });
  await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', String(18 / 13)));
  const body = content.locator('.settings-page-body');
  await expect.poll(() => body.evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(387);
  await content.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => content.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect((await content.locator('input[type="password"]').boundingBox())!.width).toBeGreaterThan(140);
  await page.screenshot({ path: testInfo.outputPath('settings-minimum-width.png'), animations: 'disabled' });
});
