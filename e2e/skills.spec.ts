/**
 * 技能系统 e2e：列表/信任/启用/详情/删除/市场/URL 导入。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, skillOps } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '技能');
});

/** 按技能名定位卡片行（name span 的第二个祖先 div = 卡片） */
const rowOf = (name: string) =>
  (page: import('@playwright/test').Page) =>
    page.locator('section').getByText(name, { exact: true }).first().locator('xpath=ancestor::div[2]');


test.describe('技能设置页', () => {
  test('技能列表：徽标（信任/禁用/含脚本/来源）与文件数', async ({ page }) => {
    await expect(page.getByText('写单测')).toBeVisible();
    await expect(page.getByText('旧脚本技能')).toBeVisible();
    const row = rowOf('旧脚本技能')(page);
    await expect(row.getByText('未信任', { exact: true })).toBeVisible();
    await expect(row.getByText('禁用', { exact: true })).toBeVisible();
    await expect(row.getByText('含脚本', { exact: true })).toBeVisible();
    await expect(row.getByText('已修改', { exact: true })).toBeVisible();
    await expect(row.getByText('market', { exact: true })).toBeVisible();
    await expect(row.getByText('3 个文件', { exact: true })).toBeVisible();
  });

  test('信任 / 启用按钮：调用 set_skill_state 并刷新徽标', async ({ page }) => {
    const row = rowOf('旧脚本技能')(page);
    await row.getByRole('button', { name: '信任' }).click();
    await expect(row.getByText('已信任', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: '启用' }).click();
    // 启用后按钮文本变「禁用」；未信任徽标消失
    await expect(row.getByRole('button', { name: '禁用' })).toBeVisible();
    const ops = await skillOps(page);
    expect(ops).toContainEqual(expect.objectContaining({ op: 'set_state', name: '旧脚本技能', trusted: true }));
    expect(ops).toContainEqual(expect.objectContaining({ op: 'set_state', name: '旧脚本技能', enabled: true }));
  });

  test('详情面板：文件树 + SKILL.md + 返回', async ({ page }) => {
    await page.getByText('写单测').click();
    await expect(page.getByRole('button', { name: '← 返回' })).toBeVisible();
    await expect(page.getByText('已信任', { exact: true }).last()).toBeVisible();
    // SKILL.md 正文
    await expect(page.getByText('先看代码，再写 vitest 单测。')).toBeVisible();
    // 打开文件夹按钮
    await expect(page.getByRole('button', { name: '打开文件夹' })).toBeVisible();
    // 返回列表
    await page.getByRole('button', { name: '← 返回' }).click();
    await expect(page.getByText('还没有技能')).toHaveCount(0);
  });

  test('详情面板文件树：点击脚本文件显示内容', async ({ page }) => {
    await page.getByText('旧脚本技能').click();
    await page.getByText('scripts', { exact: true }).first().click(); // 展开目录
    await page.getByText('run.sh', { exact: true }).first().click();
    await expect(page.getByText('这是技能文件 旧脚本技能/scripts/run.sh 的内容。')).toBeVisible();
  });

  test('删除技能：确认后移除并提示', async ({ page }) => {
    const row = rowOf('写单测')(page);
    await row.getByTitle('删除技能').click();
    await expect(page.getByText('已删除 写单测')).toBeVisible();
    await expect(page.getByText('写单测')).toHaveCount(0);
    const ops = await skillOps(page);
    expect(ops).toContainEqual(expect.objectContaining({ op: 'remove', name: '写单测' }));
  });

  test('技能市场：浏览仓库 → 安装 → 已安装标记', async ({ page }) => {
    await page.getByRole('button', { name: /技能市场/ }).click();
    await expect(page.getByText('技能市场', { exact: true }).last()).toBeVisible();
    // 选预置仓库并浏览
    await page.getByRole('combobox', { name: '技能市场仓库' }).click();
    await page.getByRole('option', { name: 'anthropics/skills', exact: true }).click();
    await page.getByRole('button', { name: '浏览' }).click();
    await expect(page.getByText('github-skill-1')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('github-skill-2')).toBeVisible();
    // 安装第一个
    // 列表第一项的安装按钮即 github-skill-1（列表顺序与 mock 一致）
    const installBtn = page.locator('section').getByRole('button', { name: '安装' }).first();
    await installBtn.click();
    await expect(page.getByText('已安装 github-skill-1')).toBeVisible();
    await expect(page.locator('section').getByText('已安装', { exact: true }).first()).toBeVisible();
    const ops = await skillOps(page);
    expect(ops).toContainEqual(expect.objectContaining({ op: 'market_install', name: 'github-skill-1' }));
    // 市场内搜索过滤（等安装 toast 消失，避免文本干扰）
    await expect(page.getByText('已安装 github-skill-1')).toHaveCount(0, { timeout: 5000 });
    await page.getByPlaceholder('搜索技能…').fill('skill-2');
    await expect(page.getByText('GitHub 操作技能', { exact: true })).toHaveCount(0);
    await expect(page.getByText('第二个仓库技能', { exact: true })).toBeVisible();
  });

  test('URL 导入：批量安装远程技能', async ({ page }) => {
    await page.getByPlaceholder('从 URL 导入技能清单').fill('https://example.com/skills.json');
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await expect(page.getByText('已安装 2 个技能')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('远程技能A')).toBeVisible();
    await expect(page.getByText('远程技能B')).toBeVisible();
    const ops = await skillOps(page);
    expect(ops.filter((o) => o.op === 'install')).toHaveLength(2);
  });

  test('安全提示条可关闭', async ({ page }) => {
    const banner = page.locator('section').getByText(/技能可能包含脚本/);
    await expect(banner).toBeVisible();
    await banner.locator('xpath=..').getByTitle('关闭').click();
    await expect(banner).toHaveCount(0);
  });
});
