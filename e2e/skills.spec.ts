/**
 * Skills system e2e: list / trust / enable / details / delete / marketplace / URL import.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, skillOps } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '技能');
});

/** Locate a card row by skill name (the second ancestor div of the name span is the card) */
const rowOf = (name: string) =>
  (page: import('@playwright/test').Page) =>
    page.locator('section').getByText(name, { exact: true }).first().locator('xpath=ancestor::div[2]');


test.describe('Skills settings page', () => {
  test('Skill list: badges (trust / disabled / script / source) and file count', async ({ page }) => {
    await expect(page.getByText('写单测')).toBeVisible();
    await expect(page.getByText('旧脚本技能')).toBeVisible();
    const row = rowOf('旧脚本技能')(page);
    await expect(row.getByText('未信任', { exact: true })).toBeVisible();
    await expect(row.getByText('已关闭', { exact: true })).toBeVisible();
    await expect(row.getByText('含脚本', { exact: true })).toBeVisible();
    await expect(row.getByText('已修改', { exact: true })).toBeVisible();
    await expect(row.getByText('market', { exact: true })).toBeVisible();
    await expect(row.getByText('3 个文件', { exact: true })).toBeVisible();
  });

  test('Trust / enable buttons: call set_skill_state and refresh badges', async ({ page }) => {
    const row = rowOf('旧脚本技能')(page);
    await row.getByRole('button', { name: '信任' }).click();
    await expect(row.getByText('已信任', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: '启用' }).click();
    // After enabling, the button label switches to "disable" and the untrusted badge disappears
    await expect(row.getByRole('button', { name: '禁用' })).toBeVisible();
    const ops = await skillOps(page);
    expect(ops).toContainEqual(expect.objectContaining({ op: 'set_state', name: '旧脚本技能', trusted: true }));
    expect(ops).toContainEqual(expect.objectContaining({ op: 'set_state', name: '旧脚本技能', enabled: true }));
  });

  test('Details panel: file tree + SKILL.md + back', async ({ page }) => {
    await page.getByText('写单测').click();
    await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible();
    await expect(page.getByText('已信任', { exact: true }).last()).toBeVisible();
    // SKILL.md body
    await expect(page.getByText('先看代码，再写 vitest 单测。')).toBeVisible();
    // Open folder button
    await expect(page.getByRole('button', { name: '打开文件夹' })).toBeVisible();
    // Back to the list
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.getByText('还没有技能')).toHaveCount(0);
  });

  test('Details panel file tree: clicking a script file shows its content', async ({ page }) => {
    await page.getByText('旧脚本技能').click();
    await page.getByText('scripts', { exact: true }).first().click(); // expand the directory
    await page.getByText('run.sh', { exact: true }).first().click();
    await expect(page.getByText('这是技能文件 旧脚本技能/scripts/run.sh 的内容。')).toBeVisible();
  });

  test('Delete skill: confirm, remove and show a notice', async ({ page }) => {
    const row = rowOf('写单测')(page);
    await row.locator('[data-tip="删除技能"]').click();
    await expect(page.getByText('已删除 写单测')).toBeVisible();
    await expect(page.getByText('写单测')).toHaveCount(0);
    const ops = await skillOps(page);
    expect(ops).toContainEqual(expect.objectContaining({ op: 'remove', name: '写单测' }));
  });

  test('Skill marketplace: browse repository → install → installed marker', async ({ page }) => {
    await page.getByRole('button', { name: /技能市场/ }).click();
    await expect(page.getByText('技能市场', { exact: true }).last()).toBeVisible();
    // Pick the preset repository and browse
    await page.getByRole('combobox', { name: '技能仓库' }).click();
    await page.getByRole('option', { name: 'anthropics/skills', exact: true }).click();
    await page.getByRole('button', { name: '浏览' }).click();
    await expect(page.getByText('github-skill-1')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('github-skill-2')).toBeVisible();
    // Install the first one
    // The install button of the first list item belongs to github-skill-1 (list order matches the mock)
    const installBtn = page.locator('section').getByRole('button', { name: '安装' }).first();
    await installBtn.click();
    await expect(page.getByText('已安装 github-skill-1')).toBeVisible();
    await expect(page.locator('section').getByText('已安装', { exact: true }).first()).toBeVisible();
    const ops = await skillOps(page);
    expect(ops).toContainEqual(expect.objectContaining({ op: 'market_install', name: 'github-skill-1' }));
    // Search filtering inside the marketplace (wait for the install toast to disappear so its text does not interfere)
    await expect(page.getByText('已安装 github-skill-1')).toHaveCount(0, { timeout: 5000 });
    await page.getByPlaceholder('搜索技能…').fill('skill-2');
    await expect(page.getByText('GitHub 操作技能', { exact: true })).toHaveCount(0);
    await expect(page.getByText('第二个仓库技能', { exact: true })).toBeVisible();
  });

  test('URL import: install remote skills in bulk', async ({ page }) => {
    await page.getByPlaceholder('从 URL 导入技能清单').fill('https://example.com/skills.json');
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await expect(page.getByText('已安装 2 个技能')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('远程技能A')).toBeVisible();
    await expect(page.getByText('远程技能B')).toBeVisible();
    const ops = await skillOps(page);
    expect(ops.filter((o) => o.op === 'install')).toHaveLength(2);
  });

  test('Security banner can be dismissed', async ({ page }) => {
    const banner = page.locator('section').getByText(/技能可能包含脚本/);
    await expect(banner).toBeVisible();
    await banner.locator('xpath=..').locator('[data-tip="关闭"]').click();
    await expect(banner).toHaveCount(0);
  });
});
