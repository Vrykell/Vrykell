import { test, expect } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';

test('restored command paths retain their own directory and new records include cwd', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const target = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> }; __BLOCK_WRITES__: Record<string, unknown>[] };
    const original = target.__TAURI_INTERNALS__.invoke;
    target.__BLOCK_WRITES__ = [];
    target.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'record_block') target.__BLOCK_WRITES__.push(args);
      const result = await original(command, args);
      if (command === 'get_session_blocks' && args.sessionId === 'hist-1') {
        return (result as Record<string, unknown>[]).map(block => ({ ...block, cwd: '/home/e2e/previous-project' }));
      }
      if (command === 'get_session' && args.id === 'hist-1') return { ...result as Record<string, unknown>, cwd: '/home/e2e/latest-project' };
      return result;
    };
  });
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('echo saved-path'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __BLOCK_WRITES__: Record<string, unknown>[] }).__BLOCK_WRITES__.filter(block => block.command === 'echo saved-path' && block.status === 'done').map(block => block.cwd))).toEqual(['/home/e2e/project']);
  await ensureTabsOpen(page);
  await page.getByTestId('tab-history-btn').click();
  await page.getByText('旧的调试会话', { exact: true }).click();
  const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'ls -la' });
  await expect(block.locator('.command-block-cwd')).toHaveText('/home/e2e/previous-project');
});
