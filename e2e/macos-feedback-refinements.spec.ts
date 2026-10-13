import { test, expect } from '@playwright/test';
import { setupTauriMock, themeConfig } from './tauri-mock';
import { gotoSetting } from './settings';

test('model header controls align with the input while save feedback lives in the page header', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '模型配置');
  for (const header of await page.locator('.settings-model-header').all()) {
    const input = (await header.locator('input').boundingBox())!;
    for (const control of await header.locator(':scope > span, :scope > button').all()) {
      const box = (await control.boundingBox())!;
      expect(Math.abs(box.y + box.height / 2 - input.y - input.height / 2)).toBeLessThan(1);
    }
    // The settings page reports saves itself, so the header keeps no inline status.
    await expect(header.getByRole('status')).toHaveCount(0);
    await expect(header.locator('input')).toHaveCSS('font-weight', '400');
  }
  const name = page.locator('.settings-model-header input').first();
  await name.fill('模型 A');
  await name.press('Enter');
  await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
  // This theme resolves --fw-medium to the regular weight, so field titles are not
  // bolder than the inputs they label.
  await expect(page.locator('.settings-field').first().locator(':scope > div').first()).toHaveCSS('font-weight', '400');
  await page.screenshot({ path: test.info().outputPath('model-alignment.png') });
});

test('wallpaper picker filters images and rejects both documents and renamed invalid images', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const target = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> }; __WALLPAPER_DIALOGS__: Record<string, unknown>[] };
    const original = target.__TAURI_INTERNALS__.invoke;
    const paths = ['/wallpaper.txt', '/invalid-wallpaper.png', '/valid-wallpaper.png', null];
    target.__WALLPAPER_DIALOGS__ = [];
    target.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'plugin:dialog|open') { target.__WALLPAPER_DIALOGS__.push(args); return paths.shift(); }
      return original(cmd, args);
    };
  });
  await page.route('**/invalid-wallpaper.png', route => route.fulfill({ body: 'This is a document', contentType: 'image/png' }));
  await page.route('**/valid-wallpaper.png', route => route.fulfill({
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png',
  }));
  await page.goto('/');
  await gotoSetting(page, '主题');
  const select = page.getByRole('button', { name: '选择图片', exact: true });
  await select.click();
  await expect(page.getByText('请选择有效的图片文件。', { exact: true })).toBeVisible();
  expect((await themeConfig(page)).backgroundImage).toBeNull();
  await select.click();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __WALLPAPER_DIALOGS__: unknown[] }).__WALLPAPER_DIALOGS__)).length).toBe(2);
  await expect(page.getByText('/invalid-wallpaper.png', { exact: true })).toHaveCount(0);
  expect((await themeConfig(page)).backgroundImage).toBeNull();
  await select.click();
  await expect.poll(async () => (await themeConfig(page)).backgroundImage).toBe('/valid-wallpaper.png');
  await select.click();
  expect((await themeConfig(page)).backgroundImage).toBe('/valid-wallpaper.png');
  const dialogs = await page.evaluate(() => (window as unknown as { __WALLPAPER_DIALOGS__: { options: { filters: { extensions: string[] }[] } }[] }).__WALLPAPER_DIALOGS__);
  expect(dialogs[0].options.filters).toHaveLength(1);
  expect(dialogs[0].options.filters[0].extensions).toContain('png');
  expect(dialogs[0].options.filters[0].extensions).not.toContain('txt');
});

test('the full panel preview accepts release and shares its surface with split placement', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const source = (await page.locator('[data-dock-btn="files"]').boundingBox())!;
  const body = (await page.locator('.workspace-body').boundingBox())!;
  const y = body.y + body.height / 2;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + body.width - 50, y, { steps: 5 });
  const preview = page.getByTestId('panel-drop-preview');
  await expect(preview).toHaveAttribute('data-side', 'right');
  const bounds = (await preview.boundingBox())!;
  await page.mouse.move(bounds.x + 2, y);
  await expect(preview).toBeVisible();
  const colors = await preview.evaluate(element => {
    const css = getComputedStyle(element);
    return { background: css.backgroundColor, border: css.borderColor, radius: css.borderRadius };
  });
  await page.mouse.up();
  await expect(page.locator('.workspace-side-panel[data-side="right"]').getByText('notes.txt')).toBeVisible();
  await page.keyboard.press('Meta+d');
  const zone = page.getByTestId('placement-zone-1');
  await expect(zone).toBeVisible();
  const split = (await zone.boundingBox())!;
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await expect(zone).toHaveAttribute('data-active', 'true');
  await expect(zone).toHaveCSS('background-color', colors.background);
  await expect(zone).toHaveCSS('border-color', colors.border);
  await expect(zone).toHaveCSS('border-radius', colors.radius);
  await page.keyboard.press('Escape');
  await expect(zone).toHaveCount(0);
});
