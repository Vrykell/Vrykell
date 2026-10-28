/**
 * Title regeneration, global search and command history e2e.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, searchCalls, ensureTabsOpen } from './tauri-mock';

test.describe('Regenerating titles (tab context menu)', () => {
  test('regenerating the title from the context menu after an AI message', async ({ page }) => {
    await mockAnthropic(page, '部署服务');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Send an AI message (triggers naming from the first message).
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.locator('[data-chat-composer]:visible');
    await input.fill('帮我部署服务');
    await input.press('Enter');
    await expect(page.locator('.chat-conversation-title:visible')).toHaveText('帮我部署服务', { timeout: 10000 });
    // Terminal title generation uses terminal activity rather than the independent conversation.
    await page.locator('[data-terminal-input]').fill('echo deploy-service');
    await page.locator('[data-terminal-input]').press('Enter');
    await expect(page.locator('.command-block-command').filter({ hasText: 'echo deploy-service' })).toBeVisible();

    // Open the tab panel, right-click the first tab and regenerate the title.
    await ensureTabsOpen(page);
    const row = page.locator('[data-testid^="tab-row-"]').first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByText('重新生成标题').click();
    await expect(page.getByText('标题已更新')).toBeVisible({ timeout: 5000 });
    // The title is updated with the generated AI result.
    await expect(row).toContainText('部署服务');
  });
});

test.describe('Global search (Cmd+F)', () => {
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
  test('search queries every source backend and renders the results', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+f');
    const box = page.getByPlaceholder('搜索文件、命令、设置…');
    await expect(box).toBeVisible({ timeout: 5000 });
    await box.fill('npm');
    // Results from the session, block and history sources.
    await expect(page.getByText('npm run dev').first()).toBeVisible({ timeout: 5000 });
    // Backend call assertions.
    const calls = await searchCalls(page);
    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toContain('search_sessions');
    expect(cmds).toContain('search_blocks');
    // The filter panel can be opened.
    await page.getByTestId('search-filter-button').click();
  });
});

test.describe('Command history (↑/↓ navigation)', () => {
  test('prefix filtering walks history and restores the draft', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });

    // Input history is read per terminal: run two commands first so the prefix can recall them.
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
    // The first Escape clears the completion ghost, the next clears the text.
    await input.press('Escape');
    await input.press('Escape');
    await expect(input).toHaveValue('');
  });
});
