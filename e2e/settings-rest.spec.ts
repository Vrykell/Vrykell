/**
 * 主题 / 打开方式 / 快捷键说明 / 网络搜索 / 权限 设置页 e2e。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, themeConfig, aiKeyCalls } from './tauri-mock';
import { gotoSetting, fieldOf, rowOf } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test.describe('主题设置页', () => {
  test('深色/浅色切换更新 data-theme', async ({ page }) => {
    await gotoSetting(page, '主题');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
    await page.getByRole('radio', { name: '浅色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');
    await page.getByRole('radio', { name: '深色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark');
  });

  test('主题模式三个选项并排，跟随系统的圆点显示系统配色', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoSetting(page, '主题');
    const group = page.getByRole('radiogroup', { name: '主题模式' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await group.getByRole('radio', { name: '跟随系统', exact: true }).click();
    // One row: every option shares the same vertical position.
    const tops = await group.getByRole('radio')
      .evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    // The follow-system dot paints the resolved scheme and follows a system change.
    const dot = group.getByRole('radio', { name: '跟随系统', exact: true }).locator('.settings-radio-dot');
    const dark = await dot.evaluate(element => getComputedStyle(element).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => dot.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(dark);
  });

  test('不透明度滑块更新后端配置与百分比显示', async ({ page }) => {
    await gotoSetting(page, '主题');
    const slider = page.locator('input[type="range"]');
    await expect(page.getByText('100%')).toBeVisible();
    await slider.fill('0.45');
    await expect(page.getByText('45%')).toBeVisible({ timeout: 3000 });
    const cfg = await themeConfig(page);
    expect(cfg.opacity).toBeCloseTo(0.45, 1);
  });

  test('配置文件路径显示与重新加载不报错', async ({ page }) => {
    await gotoSetting(page, '主题');
    await expect(page.getByText('/home/e2e/.vrykell/theme.json')).toBeVisible();
    await page.getByRole('button', { name: /重新加载/ }).click();
    await page.getByRole('button', { name: /导出主题/ }).click();
  });
});

test.describe('打开方式设置页', () => {
  test('各 shell 默认块模式，切经典模式持久化', async ({ page }) => {
    await gotoSetting(page, '打开方式');
    // 5 行 shell
    await expect(page.locator('section').getByText('Zsh', { exact: true })).toBeVisible();
    await expect(page.locator('section').getByText('CMD', { exact: true })).toBeVisible();
    // Zsh 行切经典
    const zshRow = rowOf(page, 'Zsh');
    await zshRow.getByRole('combobox', { name: 'Zsh 打开模式' }).click();
    await page.getByRole('option', { name: '经典模式', exact: true }).click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"zsh":"classic"');
  });

  test('SSH 打开方式：默认经典，可切换块模式并持久化', async ({ page }) => {
    await gotoSetting(page, '打开方式');
    const sshRow = rowOf(page, 'SSH');
    // 默认经典
    await expect(sshRow.getByRole('combobox', { name: 'SSH 打开模式' })).toHaveText('经典模式');
    await sshRow.getByRole('combobox', { name: 'SSH 打开模式' }).click();
    await page.getByRole('option', { name: '块模式', exact: true }).click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"sshOpenMode":"block"');
  });
});

test.describe('快捷键说明页', () => {
  test('列出全部快捷键', async ({ page }) => {
    await gotoSetting(page, '快捷键说明');
    await expect(page.getByText('新建标签页')).toBeVisible();
    await expect(page.getByText('全局搜索')).toBeVisible();
    await expect(page.getByText('打开设置')).toBeVisible();
    // Shortcut badges follow the platform modifier the app advertises.
    const mod = await page.evaluate(() => /Mac/.test(navigator.userAgent) ? 'Meta' : 'Control');
    await expect(page.getByLabel(`${mod}+T`, { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByLabel(`${mod}+F`, { exact: true })).toBeVisible();
  });
});

test.describe('网络搜索页', () => {
  test('搜索方式显示与 Tavily Key 保存/清除', async ({ page }) => {
    await gotoSetting(page, '网络搜索');
    await expect(page.getByText('DuckDuckGo 兜底', { exact: true })).toBeVisible();
    await expect(page.getByText('未配置', { exact: true })).toBeVisible();

    const keyField = fieldOf(page, 'Tavily API Key');
    await keyField.getByPlaceholder(/输入 Tavily API Key/).fill('tv-e2e');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await expect(page.getByText('已配置', { exact: true })).toBeVisible();
    const calls = await aiKeyCalls(page);
    expect(calls.some((c) => c.provider === 'tavily' && c.key === 'tv-e2e')).toBe(true);

    await keyField.getByRole('button', { name: '清除' }).click();
    await expect(page.getByText('已清除 Tavily Key')).toBeVisible();
    await expect(keyField.getByText('未配置', { exact: true })).toBeVisible();
  });
});

test.describe('模型权限页', () => {
  test('工具权限分级切换持久化', async ({ page }) => {
    await gotoSetting(page, '模型权限');
    // 执行终端命令 → 禁止
    const runRow = rowOf(page, '执行终端命令');
    await runRow.getByRole('combobox', { name: '执行终端命令 权限' }).click();
    await page.getByRole('option', { name: '禁止', exact: true }).click();
    let saved = await page.evaluate(() => localStorage.getItem('vrykell-permissions') ?? '');
    expect(saved).toContain('"run_command":"deny"');
    // 联网搜索 → 每次询问
    const webRow = rowOf(page, '联网搜索');
    await webRow.getByRole('combobox', { name: '联网搜索 权限' }).click();
    await page.getByRole('option', { name: '每次询问', exact: true }).click();
    saved = await page.evaluate(() => localStorage.getItem('vrykell-permissions') ?? '');
    expect(saved).toContain('"web_search":"ask"');
  });

  test('清空会话授权按钮提示成功', async ({ page }) => {
    await gotoSetting(page, '模型权限');
    await page.getByRole('button', { name: '清空会话授权' }).click();
    await expect(page.getByText('已清空全部会话授权')).toBeVisible();
  });
});
