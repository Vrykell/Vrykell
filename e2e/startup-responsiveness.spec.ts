import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import type { WorkbenchSnapshot, WorkspaceContainer } from '../src/features/workspace/model/workbench';

test('restores a large workspace without duplicating drafts or blocking global interactions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setupTauriMock(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('large-workspace-seeded')) return;
    const tabs: WorkspaceContainer[] = [];
    for (let index = 0; index < 768; index++) {
      const resourceId = `chat:restored-${index}`;
      const layout = { type: 'pane' as const, id: `pane-${index}`, resourceId };
      const tab: WorkspaceContainer = { id: resourceId, scope: 'ai', layout, focused: layout.id,
        restoreSnapshot: { version: 1, layout, focused: layout.id, members: [{ id: resourceId, reference: `restored-${index}`, title: 'Restored draft',
          kind: 'conversation', empty: true, paneCount: 1, local: false, ssh: false }] } };
      tabs.push(tab);
      if (index < 357) tabs.push({ ...tab, id: `mixed-${index}`, scope: 'unified' });
    }
    const saved: WorkbenchSnapshot = { version: 2, tabs, groups: [], selected: { ai: 'chat:restored-0', unified: 'mixed-0' }, order: {} };
    localStorage.setItem('workspace-containers-v2', JSON.stringify(saved));
    localStorage.setItem('vrykell-startup-mode', 'restore');
    localStorage.setItem('large-workspace-seeded', 'true');
  });
  const restored = async () => {
    const path = '/src/features/workspace/stores/workbench.ts';
    const { useWorkbenchStore } = await import(path) as typeof import('../src/features/workspace/stores/workbench');
    return useWorkbenchStore.getState().ready;
  };
  for (let run = 0; run < 2; run++) {
    if (run) await page.reload(); else await page.goto('/');
    await expect.poll(() => page.evaluate(restored), { timeout: 60_000 }).toBe(true);
    const counts = await page.evaluate(async () => {
      const path = '/src/features/workspace/stores/workbench.ts';
      const { useWorkbenchStore } = await import(path) as typeof import('../src/features/workspace/stores/workbench');
      return useWorkbenchStore.getState().snapshot.tabs.reduce<Record<string, number>>((counts, tab) => {
        counts[tab.scope] = (counts[tab.scope] ?? 0) + 1; return counts;
      }, {});
    });
    expect(counts.ai).toBe(768); expect(counts.unified).toBe(357);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('.settings-navigation')).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const input = page.locator('[data-terminal-input]:visible');
    await input.click(); await page.keyboard.type('echo responsive');
    await expect(input).toHaveValue('echo responsive');
    await page.keyboard.press('Enter');
    await expect(page.locator('.command-block-command').filter({ hasText: 'echo responsive' }).last()).toBeVisible();
  }
  expect(errors).toEqual([]);
});
