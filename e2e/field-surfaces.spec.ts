import { test, expect, type Locator } from '@playwright/test';
import { setupTauriMock, memoryFact } from './tauri-mock';
import { gotoSetting } from './settings';

const channels = (color: string) => color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number);
const luminance = (color: string) => channels(color).map(value => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

async function expectFieldHierarchy(field: Locator, editable = true) {
  await expect(field).toBeVisible();
  const colors = await field.evaluate(element => {
    const style = getComputedStyle(element);
    let ancestor = element.parentElement;
    let panel = 'rgba(0, 0, 0, 0)';
    while (ancestor && panel === 'rgba(0, 0, 0, 0)') {
      panel = getComputedStyle(ancestor).backgroundColor;
      ancestor = ancestor.parentElement;
    }
    return { field: style.backgroundColor, panel, text: style.color };
  });
  const fieldRgb = channels(colors.field);
  const panelRgb = channels(colors.panel);
  expect(new Set(fieldRgb).size).toBe(1);
  if (editable) {
    expect(luminance(colors.field)).toBeGreaterThan(luminance(colors.panel));
    expect(Math.max(...fieldRgb.map((value, index) => value - panelRgb[index]))).toBeLessThanOrEqual(36);
  } else {
    expect(colors.field).toBe(colors.panel);
  }
  const values = [luminance(colors.field), luminance(colors.text)];
  expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['深色', '浅色']) {
  test(`editable fields are lighter than panels and readouts stay quiet in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.mouse.move(0, 0);
    const preview = page.locator('.settings-terminal-preview');
    await expectFieldHierarchy(preview, false);
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
    await expectFieldHierarchy(page.getByPlaceholder('模型名称').first());
    await page.screenshot({ path: test.info().outputPath('model-fields.png') });
    await page.locator('aside').getByRole('button', { name: '记忆', exact: true }).click();
    const memory = page.getByPlaceholder(/持久知识/);
    await expectFieldHierarchy(memory);
    await memory.fill('surface editing check');
    await memory.blur();
    await expect.poll(() => memoryFact(page)).toBe('surface editing check');
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
    const search = page.getByPlaceholder('搜索标签页类型…');
    await expectFieldHierarchy(search.locator('xpath=..'));
    await search.fill('zsh');
    await expect(page.getByTestId('new-tab-option-shell:zsh')).toBeVisible();
    await search.press('Escape');

    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-new-btn').click();
    const host = page.getByTestId('ssh-form-host');
    await expectFieldHierarchy(host);
    await host.fill('example.invalid');
    await expect(host).toHaveCSS('outline-style', 'none');
    await expect(host).toHaveValue('example.invalid');
    await page.screenshot({ path: test.info().outputPath('ssh-fields.png') });
    await page.getByRole('dialog', { name: 'SSH 连接' }).getByRole('button', { name: '取消', exact: true }).click();
  });
}
