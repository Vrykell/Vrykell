import { test, expect } from '@playwright/test';
import { setupTauriMock, themeConfig } from './tauri-mock';
import { gotoSetting } from './settings';
import { focusedPane, hoverPlacementZone } from './placement';

test('settings save feedback lives in the page header while field titles stay regular', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '模型配置');
  // The model page's fields save on their own; the header reports the save and no field keeps an
  // inline status of its own while the page reports.
  const endpoint = page.getByTestId('provider-endpoint-input');
  await expect(endpoint).toBeVisible();
  await endpoint.fill('https://gateway.example/v1');
  await endpoint.press('Enter');
  await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
  // This theme resolves --fw-medium to the regular weight, so field titles are not bolder than
  // the inputs they label.
  await expect(page.locator('.settings-field').first().locator(':scope > div').first()).toHaveCSS('font-weight', '400');
  await page.screenshot({ path: test.info().outputPath('model-alignment.png') });
});

test('wallpaper picker filters images and rejects both documents and renamed invalid images', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const target = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> };
      __WALLPAPER_DIALOGS__: Record<string, unknown>[];
      __WALLPAPER_READS__: string[];
    };
    const original = target.__TAURI_INTERNALS__.invoke;
    const paths = ['/wallpaper.txt', '/invalid-wallpaper.png', '/valid-wallpaper.png', null];
    target.__WALLPAPER_DIALOGS__ = [];
    target.__WALLPAPER_READS__ = [];
    target.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'plugin:dialog|open') { target.__WALLPAPER_DIALOGS__.push(args); return paths.shift(); }
      // The candidate is read by the backend, so the test answers that call instead of
      // serving the asset-protocol URL the picker must not depend on.
      if (cmd === 'read_image_data_url') {
        target.__WALLPAPER_READS__.push(args.path as string);
        if (args.path === '/valid-wallpaper.png') {
          return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
        }
        return `data:image/png;base64,${btoa('This is a document')}`;
      }
      return original(cmd, args);
    };
  });
  await page.goto('/');
  await gotoSetting(page, '主题');
  const select = page.getByRole('button', { name: '选择图片', exact: true });
  // Toasts are the only floating status surfaces; the page header also reports saves.
  const toast = page.locator('[role="status"].workspace-floating');
  const dismissToast = async () => {
    await expect(toast).toHaveCount(1);
    await toast.getByRole('button', { name: '关闭通知' }).click();
    await expect(toast).toHaveCount(0);
  };
  await select.click();
  await dismissToast();
  expect((await themeConfig(page)).backgroundImage).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __WALLPAPER_READS__: string[] }).__WALLPAPER_READS__)).toHaveLength(0);
  await select.click();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __WALLPAPER_READS__: string[] }).__WALLPAPER_READS__))[0]).toBe('/invalid-wallpaper.png');
  await dismissToast();
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
  const reads = await page.evaluate(() => (window as unknown as { __WALLPAPER_READS__: string[] }).__WALLPAPER_READS__);
  expect(reads).toEqual(['/invalid-wallpaper.png', '/valid-wallpaper.png']);
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
    return { background: css.backgroundColor, border: css.borderColor, radius: css.borderRadius, blur: css.backdropFilter };
  });
  expect(colors.blur).toBe(await page.getByTestId('workspace-sidebar').evaluate(element => getComputedStyle(element).backdropFilter));
  expect(colors.blur).toContain('blur(20px)');
  await page.mouse.up();
  await expect(page.locator('.workspace-side-panel[data-side="right"]').getByText('notes.txt')).toBeVisible();
  await page.keyboard.press('Meta+d');
  await hoverPlacementZone(page, focusedPane(page), 'right');
  const zone = page.getByTestId('placement-zone-1');
  await expect(zone).toBeVisible();
  await expect(zone).toHaveAttribute('data-active', 'true');
  await expect(zone).toHaveCSS('background-color', colors.background);
  await expect(zone).toHaveCSS('border-color', colors.border);
  await expect(zone).toHaveCSS('border-radius', colors.radius);
  await expect(zone).toHaveCSS('backdrop-filter', colors.blur);
  // 指针离开布局区后预览消失，不残留网格描边
  const dock = (await page.locator('[data-dock-btn="files"]').boundingBox())!;
  await page.mouse.move(dock.x + dock.width / 2, dock.y + dock.height / 2);
  await expect(zone).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('placement-overlay')).toHaveCount(0);
});
