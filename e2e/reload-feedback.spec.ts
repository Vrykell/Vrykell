import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('theme reload spins until loading completes and honors reduced motion', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '主题文件');
  await page.evaluate(() => {
    const scope = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> };
      __finishThemeReload: () => void;
    };
    const original = scope.__TAURI_INTERNALS__.invoke;
    scope.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'get_theme_config') await new Promise<void>(resolve => { scope.__finishThemeReload = resolve; });
      return original(cmd, args);
    };
  });
  const reload = page.getByRole('button', { name: '重新加载', exact: true });
  await reload.click();
  await expect(reload).toHaveAttribute('aria-busy', 'true');
  await expect(reload).toBeDisabled();
  await expect(reload.locator('svg')).toHaveCSS('animation-name', 'spin');
  await expect(reload.locator('svg')).toHaveCSS('animation-duration', '0.8s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(reload.locator('svg')).toHaveCSS('animation-name', 'none');
  await expect(reload).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => (window as unknown as { __finishThemeReload: () => void }).__finishThemeReload());
  await expect(reload).toHaveAttribute('aria-busy', 'false');
  await expect(reload).toBeEnabled();
});

test('terminal context chips retain spacing without separator dots', async ({ page }) => {
  await setupTauriMock(page);
  // Keep the live git-status refresh on the same branch as the fixture below, otherwise a
  // late refresh can overwrite the seeded block and make the chip assertion order-dependent.
  await page.addInitScript(() => localStorage.setItem('mock-git-snapshot', JSON.stringify({
    root: '/home/e2e/project', branch: 'dev', remotes: [], entries: [],
  })));
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/terminal/stores/blocks.ts';
    const { useBlockStore } = await import(path) as typeof import('../src/features/terminal/stores/blocks');
    const state = useBlockStore.getState();
    for (const [paneId, blocks] of Object.entries(state.byTab)) {
      state.setBlocks(paneId, blocks.map(block => ({ ...block, gitBranch: 'dev' })));
    }
  });
  const status = page.locator('.terminal-input-status:visible').first();
  await expect(status.locator('.terminal-branch')).toHaveText('dev');
  await expect(status.locator('.terminal-chip')).toHaveCount(3);
  await expect(status).not.toContainText('·');
  await expect(status).toHaveCSS('gap', '6px');
  const chips = await status.locator('.terminal-chip').all();
  const bounds = await Promise.all(chips.map(chip => chip.boundingBox()));
  for (let index = 1; index < bounds.length; index++) {
    expect(bounds[index]!.x - bounds[index - 1]!.x - bounds[index - 1]!.width).toBeGreaterThanOrEqual(5);
  }
});
