import { test, expect, type Locator, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

/** Chromium serializes color-mix() results as `color(srgb r g b)` with 0..1 channels. */
const channels = (color: string) => {
  const values = color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number);
  return color.startsWith('color(') ? values.map(value => value * 255) : values;
};
/** Transparent ancestors are skipped while looking for the panel behind a field. */
const transparent = (color: string) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
  || /\s\/\s*0(?:\.0+)?\)$/.test(color) || (/^rgba\(/.test(color) && /,\s*0(?:\.0+)?\)$/.test(color));
const luminance = (color: string) => channels(color).map(value => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

/** Theme switches animate surface colors, so measure only once every background has settled. */
async function settleSurfaceColors(page: Page) {
  await page.getByRole('combobox', { name: '终端字号' }).evaluate(element => new Promise<void>(resolve => {
    const deadline = performance.now() + 1000;
    let previous = '';
    let stable = 0;
    const frame = () => {
      const current = getComputedStyle(element).backgroundColor;
      stable = current === previous ? stable + 1 : 0;
      previous = current;
      if (stable >= 2 || performance.now() > deadline) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
}

async function expectFieldHierarchy(field: Locator, editable: boolean | null = true) {
  await expect(field).toBeVisible();
  const colors = await field.evaluate(element => {
    const style = getComputedStyle(element);
    const chain: string[] = [];
    let ancestor = element.parentElement;
    while (ancestor && chain.length < 12) {
      chain.push(getComputedStyle(ancestor).backgroundColor);
      ancestor = ancestor.parentElement;
    }
    return { field: style.backgroundColor, chain, text: style.color };
  });
  const panel = colors.chain.find(color => !transparent(color)) ?? 'rgba(0, 0, 0, 0)';
  const fieldRgb = channels(colors.field);
  const panelRgb = channels(panel);
  expect(new Set(fieldRgb).size).toBe(1);
  if (editable) {
    expect(luminance(colors.field)).toBeGreaterThanOrEqual(luminance(panel));
    expect(Math.max(...fieldRgb.map((value, index) => value - panelRgb[index]))).toBeLessThanOrEqual(36);
  } else if (editable === false) {
    expect(colors.field).toBe(panel);
  }
  const values = [luminance(colors.field), luminance(colors.text)];
  expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['深色', '浅色']) {
  test(`editable fields are lighter than panels and readouts stay quiet in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: `始终${theme}`, exact: true }).click();
    await page.locator('aside').getByRole('button', { name: '字体与显示', exact: true }).click();
    await settleSurfaceColors(page);
    await page.mouse.move(0, 0);
    const preview = page.locator('.settings-terminal-preview');
    await expectFieldHierarchy(preview, null);
    const fontSize = page.getByRole('combobox', { name: '终端字号' });
    await expectFieldHierarchy(fontSize);
    const fieldColor = await fontSize.evaluate(element => getComputedStyle(element).backgroundColor);
    await fontSize.hover();
    if (theme === '深色') {
      await expect.poll(() => fontSize.evaluate(element => getComputedStyle(element).backgroundColor).then(luminance))
        .toBeGreaterThan(luminance(fieldColor));
    }
    await page.mouse.move(0, 0);
    await expect(fontSize).toHaveCSS('background-color', fieldColor);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('theme-preview.png') });

    await page.locator('aside').getByRole('button', { name: '模型配置', exact: true }).click();
    await page.getByTestId('model-settings').first().click();
    await expectFieldHierarchy(page.getByPlaceholder('模型名称').first());
    await page.screenshot({ path: test.info().outputPath('model-fields.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+1');
    const composer = page.locator('.terminal-composer').first();
    await expectFieldHierarchy(composer);
    const resting = await composer.evaluate(element => getComputedStyle(element).backgroundColor);
    await page.getByPlaceholder(/输入命令/).fill('echo surface-hierarchy');
    await expect(composer).toHaveCSS('box-shadow', 'none');
    await expect(composer).toHaveCSS('background-color', resting);
    await page.getByPlaceholder(/输入命令/).blur();
    await expect(composer).toHaveCSS('background-color', resting);
    await page.screenshot({ path: test.info().outputPath('composer.png') });

    await page.getByRole('button', { name: '切换工作目录' }).click();
    await expectFieldHierarchy(page.locator('.directory-picker-search'));
    await page.locator('.directory-picker-search').press('Escape');
    await page.getByTestId('tab-new-btn').click();
    const picker = page.getByRole('dialog', { name: '新建标签页' });
    await expect(picker.getByTestId('new-tab-option-shell:zsh')).toHaveClass(/workspace-floating-row/);
    await expect(page.getByTestId('new-tab-option-shell:zsh')).toBeVisible();
    await picker.press('Escape');

    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-new-btn').click();
    const host = page.getByTestId('ssh-form-host');
    await expectFieldHierarchy(host);
    await host.fill('example.invalid');
    await expect(host).toHaveCSS('outline-style', 'none');
    await expect(host).toHaveValue('example.invalid');
    await page.screenshot({ path: test.info().outputPath('ssh-fields.png') });
    await page.getByTestId('ssh-host-editor').getByRole('button', { name: '取消', exact: true }).click();
  });
}
