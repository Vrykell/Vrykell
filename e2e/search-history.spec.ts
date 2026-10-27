/**
 * 标题重生成 + 全局搜索 + 命令历史 e2e。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, searchCalls, ensureTabsOpen } from './tauri-mock';

test.describe('重新生成标题（标签右键菜单）', () => {
  test('AI 模式发消息后右键重新生成标题', async ({ page }) => {
    await mockAnthropic(page, '部署服务');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // 发一条 AI 消息（触发首条消息命名）
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.locator('[data-chat-composer]:visible');
    await input.fill('帮我部署服务');
    await input.press('Enter');
    await expect(page.locator('.chat-conversation-title:visible')).toHaveText('帮我部署服务', { timeout: 10000 });
    // Terminal title generation uses terminal activity rather than the independent conversation.
    await page.locator('[data-terminal-input]').fill('echo deploy-service');
    await page.locator('[data-terminal-input]').press('Enter');
    await expect(page.locator('.command-block-command').filter({ hasText: 'echo deploy-service' })).toBeVisible();

    // 打开标签面板，右键第一个标签 → 重新生成标题
    await ensureTabsOpen(page);
    const row = page.locator('[data-testid^="tab-row-"]').first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByText('重新生成标题').click();
    await expect(page.getByText('标题已更新')).toBeVisible({ timeout: 5000 });
    // 标题被 AI 生成结果更新
    await expect(row).toContainText('部署服务');
  });
});

test.describe('全局搜索（Cmd+F）', () => {
  test('setting results open their matching page on first and subsequent visits', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    for (const [query, target, label] of [['主题', '主题', '主题'], ['文件打开方式', '本地文件打开方式', '默认编辑命令']]) {
      await page.getByTestId('global-search-trigger').click();
      const dialog = page.getByRole('dialog', { name: '全局搜索' });
      await dialog.getByPlaceholder('搜索文件、命令、设置…').fill(query);
      await dialog.locator('[data-search-result]').filter({ has: page.getByText(label, { exact: true }) }).first().click();
      await expect(page.locator('section').getByText(target, { exact: true }).first()).toBeVisible();
      await expect(dialog).not.toBeVisible();
    }
  });
  test('搜索触发各来源后端并渲染结果', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+f');
    const box = page.getByPlaceholder('搜索文件、命令、设置…');
    await expect(box).toBeVisible({ timeout: 5000 });
    await box.fill('npm');
    // 会话/块/历史来源的结果
    await expect(page.getByText('npm run dev').first()).toBeVisible({ timeout: 5000 });
    // 后端调用断言
    const calls = await searchCalls(page);
    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toContain('search_sessions');
    expect(cmds).toContain('search_blocks');
    // 筛选面板可打开
    await page.getByTestId('search-filter-button').click();
  });
});

test.describe('命令历史（↑/↓ 翻历史）', () => {
  test('前缀过滤翻历史与还原草稿', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });

    // 输入历史按当前终端读取：先在该终端执行两条命令，供前缀召回
    for (const command of ['git status', 'git log']) {
      await input.fill(command);
      await input.press('Enter');
      await expect(page.locator('.command-block-command').filter({ hasText: command })).toBeVisible();
    }
    await input.fill('git st');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('git status');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('git st');
    // Esc 先清补全 ghost，再按一次清空文本
    await input.press('Escape');
    await input.press('Escape');
    await expect(input).toHaveValue('');
  });
});
