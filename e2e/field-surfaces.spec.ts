import { test, expect, type Locator } from '@playwright/test';
import { setupTauriMock, memoryFact } from './tauri-mock';
import { gotoSetting } from './settings';

async function expectQuietField(field: Locator) {
  await expect(field).toBeVisible();
  const colors = await field.evaluate(element => {
    const style = getComputedStyle(element);
    const probe = document.createElement('div');
    probe.style.background = 'var(--surface)';
    document.body.appendChild(probe);
    const panel = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { field: style.backgroundColor, panel, text: style.color };
  });
  const channels = (color: string) => color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number);
  const fieldRgb = channels(colors.field);
  const panelRgb = channels(colors.panel);
  expect(new Set(fieldRgb).size).toBe(1);
  expect(Math.max(...fieldRgb.map((value, index) => Math.abs(value - panelRgb[index])))).toBeLessThanOrEqual(12);
  const luminance = (color: string) => channels(color).map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(colors.field), luminance(colors.text)];
  expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['深色', '浅色']) {
  test(`fields and previews blend into panels and retain editing in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.mouse.move(0, 0);
    const preview = page.locator('.settings-terminal-preview');
    await expectQuietField(preview);
    await expectQuietField(page.getByRole('combobox', { name: '终端字号' }));
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('theme-preview.png') });

    await page.locator('aside').getByRole('button', { name: '模型配置', exact: true }).click();
    await expectQuietField(page.getByPlaceholder('模型名称').first());
    await page.screenshot({ path: test.info().outputPath('model-fields.png') });
    await page.locator('aside').getByRole('button', { name: '记忆', exact: true }).click();
    const memory = page.getByPlaceholder(/持久知识/);
    await expectQuietField(memory);
    await memory.fill('surface editing check');
    await memory.blur();
    await expect.poll(() => memoryFact(page)).toBe('surface editing check');
    await page.keyboard.press('Meta+1');

    await page.getByRole('button', { name: '切换工作目录' }).click();
    await expectQuietField(page.locator('.directory-picker-search'));
    await page.locator('.directory-picker-search').press('Escape');
    await page.getByTestId('tab-new-btn').click();
    const search = page.getByPlaceholder('搜索标签页类型…');
    await expectQuietField(search.locator('xpath=..'));
    await search.fill('zsh');
    await expect(page.getByTestId('new-tab-option-shell:zsh')).toBeVisible();
    await search.press('Escape');

    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-new-btn').click();
    const host = page.getByTestId('ssh-form-host');
    await expectQuietField(host);
    await host.fill('example.invalid');
    await expect(host).toHaveValue('example.invalid');
    await page.screenshot({ path: test.info().outputPath('ssh-fields.png') });
    await page.getByRole('dialog', { name: 'SSH 连接' }).getByRole('button', { name: '取消', exact: true }).click();
  });
}
