/**
 * 记忆 / 子代理 / 定时任务 设置页 e2e。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, memoryOps, memoryFact, agentOps, scheduleOps } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test.describe('记忆设置页', () => {
  test('加载 FACT 与流水；编辑保存；清空', async ({ page }) => {
    await gotoSetting(page, '内存');
    const ta = page.locator('section').getByPlaceholder(/持久知识/);
    await expect(ta).toHaveValue(/用户偏好：优先用 Rust/);
    await expect(page.getByText('近期流水')).toBeVisible();
    await expect(page.getByText(/修复了工具注册 bug/)).toBeVisible();

    // 编辑保存
    await ta.fill('新的事实内容');
    await expect(page.getByRole('status').filter({ hasText: /^已保存$/ }).first()).toBeVisible();
    expect(await memoryFact(page)).toBe('新的事实内容');
    expect((await memoryOps(page)).some((o) => o.op === 'set' && o.content === '新的事实内容')).toBe(true);

    // 清空
    await page.getByRole('button', { name: '清空' }).click();
    await expect(page.getByText('已清空持久知识')).toBeVisible();
    expect(await memoryFact(page)).toBe('');
  });
});

test.describe('子代理设置页', () => {
  test('列表渲染；添加/编辑/删除', async ({ page }) => {
    await gotoSetting(page, '子代理');
    const nameInputs = page.locator('section').getByPlaceholder('名称');
    await expect(nameInputs.first()).toHaveValue('代码审查员');

    // 添加（返回副本 → React 重渲染出新卡）
    await page.getByRole('button', { name: /添加子代理/ }).click();
    await expect(nameInputs).toHaveCount(2);
    await nameInputs.nth(1).fill('测试代理');
    await page.locator('section').getByPlaceholder(/一句话描述/).nth(1).fill('跑测试');
    await nameInputs.nth(1).press('Tab');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    expect((await agentOps(page)).some((o) => o.op === 'save' && (o.agent as { name: string }).name === '测试代理')).toBe(true);

    // 删除
    const card = nameInputs.nth(1).locator('xpath=../..');
    await card.locator('[data-tip="删除"]').click();
    await expect(page.locator('section').getByPlaceholder('名称')).toHaveCount(1);
    expect((await agentOps(page)).some((o) => o.op === 'remove')).toBe(true);
  });
});

test.describe('定时任务设置页', () => {
  test('列表渲染；添加/保存/启停/删除', async ({ page }) => {
    await gotoSetting(page, '定时任务');
    const names = page.locator('section').getByPlaceholder('名称');
    await expect(names.first()).toHaveValue('每日巡检');
    await expect(page.getByText(/上次执行 从未/)).toBeVisible();

    // 添加
    await page.getByRole('button', { name: /添加任务/ }).click();
    await expect(names).toHaveCount(2);
    await names.nth(1).fill('夜间备份');
    await page.locator('section').getByLabel('要执行的提示词', { exact: true }).nth(1).fill('执行备份脚本');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    expect((await scheduleOps(page)).some((o) => o.op === 'save' && (o.schedule as { name: string }).name === '夜间备份')).toBe(true);

    // 启停
    const card = names.first().locator('xpath=../..');
    await card.getByRole('button', { name: '停用' }).click();
    await expect(card.getByRole('button', { name: '启用' })).toBeVisible();

    // 删除
    await card.locator('[data-tip="删除"]').click();
    await expect(page.locator('section').getByPlaceholder('名称')).toHaveCount(1);
    expect((await scheduleOps(page)).some((o) => o.op === 'remove')).toBe(true);
  });
});
