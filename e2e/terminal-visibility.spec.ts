import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

const WS_STORE = '/src/features/workspace/stores/workspace.ts';
const TERM_STORE = '/src/features/terminal/stores/terminal.ts';

async function ready(page: Page) {
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await page.waitForFunction(async (path) => {
    const { useTerminalStore } = await import(/* @vite-ignore */ path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  }, TERM_STORE);
}

test('switching back to a tab repaints the hidden terminal view', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await ready(page);

  const paneId = (await page.locator('.terminal-pane:visible').first().getAttribute('data-testid'))!.slice('pane-'.length);
  const tabA = await page.evaluate(async (path) => {
    const mod = await import(/* @vite-ignore */ path);
    return mod.useWorkspaceStore.getState().activeId as string;
  }, WS_STORE);

  // Record repaints of this pane's terminal.
  await page.evaluate((id) => {
    const map = (window as unknown as { __vrykellTerms: Map<string, { refresh: (...a: unknown[]) => void }> }).__vrykellTerms;
    const term = map.get(id)!;
    const state = window as unknown as { __repaints: number };
    state.__repaints = 0;
    const original = term.refresh.bind(term);
    term.refresh = (...args: unknown[]) => { state.__repaints++; return original(...args); };
  }, paneId);

  // Switch away to a new tab (hides the pane), then back.
  const tabB = await page.evaluate(async (path) => {
    const mod = await import(/* @vite-ignore */ path);
    return mod.useWorkspaceStore.getState().addTab() as string;
  }, WS_STORE);
  await expect(page.locator(`[data-testid="pane-${paneId}"]`)).toBeHidden();
  // Wait until the pane really has no layout box, which is what the repaint observer keys on.
  await expect
    .poll(() => page.evaluate((sel) => document.querySelector<HTMLElement>(sel)?.offsetWidth ?? -1,
      `[data-testid="pane-${paneId}"] .xterm`), { timeout: 5000 })
    .toBe(0);
  await page.evaluate(async ({ path, id }) => {
    const mod = await import(/* @vite-ignore */ path);
    mod.useWorkspaceStore.getState().activate(id);
  }, { path: WS_STORE, id: tabA });
  await expect(page.locator(`[data-testid="pane-${paneId}"]`)).toBeVisible();

  expect(tabB).not.toBe(tabA);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __repaints?: number }).__repaints ?? 0), { timeout: 5000 })
    .toBeGreaterThan(0);
});
