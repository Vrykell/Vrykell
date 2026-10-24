import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`unified hosts follow the list and card prototypes in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('e2e-conversations', JSON.stringify([{ id: 'favorite-chat', title: 'Deployment notes', created_at: Date.now(), updated_at: Date.now(), environment: 'null' }]));
  }, theme);
  await page.goto('/');
  await page.evaluate(async () => {
    document.documentElement.dataset.nativeMaterial = 'fallback';
    const storePath = '/src/features/ssh/stores/store.ts'; const libraryPath = '/src/features/ssh/stores/hostLibrary.ts';
    const { useSshStore } = await import(storePath) as typeof import('../src/features/ssh/stores/store');
    const { useHostLibrary } = await import(libraryPath) as typeof import('../src/features/ssh/stores/hostLibrary');
    await useSshStore.getState().load();
    const seed = useSshStore.getState().connections[0]!;
    const names = ['prod-api-tokyo', 'bastion-tokyo', 'db-osaka-01', 'prod-api-tokyo-02', 'staging-web-02', 'db-osaka-02', 'staging-worker-01', 'ci-runner-01', 'edge-sg-cache', 'homelab-nas', 'pi-hole'];
    const connections = names.map((name, index) => ({ ...seed, id: index ? `prototype-${index}` : 'ssh-1', name, host: `10.24.3.${index + 11}`, lastOpenedAt: Date.now() - index * 3_600_000 }));
    for (const [index, connection] of connections.entries()) useHostLibrary.getState().update(connection.id, { group: ['Tokyo', 'Osaka', 'Staging', 'Infrastructure', 'Home'][index % 5], tags: index < 4 ? ['production', 'api'] : ['staging'], starred: index < 3 || index === 9 });
    useSshStore.setState({ connections });
    const metaPath = '/src/utils/historyMeta.ts'; const chatPath = '/src/features/chat/stores/chat.ts';
    const { useHistoryMetaStore } = await import(metaPath) as typeof import('../src/utils/historyMeta');
    const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    useHistoryMetaStore.getState().setStarred(['session:hist-1', 'conversation:favorite-chat'], true);
    const ipcPath = '/src/platform/diagnostics.ts'; const { invoke } = await import(ipcPath) as typeof import('../src/platform/diagnostics');
    await invoke('save_conversation', { id: 'favorite-chat', title: 'Deployment notes', createdAt: Date.now(), updatedAt: Date.now(), environment: 'null' });
    useChatStore.setState({ conversationsLoaded: true, conversations: [{ id: 'favorite-chat', title: 'Deployment notes', createdAt: Date.now(), updatedAt: Date.now(), environment: null }] });
  });
  const starColor = await page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--favorite-color)'; document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; });
  await page.getByTestId('workspace-history').click();
  for (const key of ['session:hist-1', 'conversation:favorite-chat']) await expect(page.getByTestId(`unified-history-${key}`).locator('.history-row-star svg')).toHaveCSS('color', starColor);
  await page.getByTestId('workspace-area-ssh').click();
  await expect(page.getByTestId('workspace-area-dashboard')).toHaveCount(0);
  const root = page.getByTestId('ssh-dashboard'); const row = page.getByTestId('ssh-row-ssh-1');
  const newButton = (await root.getByTestId('ssh-new-btn').boundingBox())!; const newMenu = (await root.getByTestId('ssh-host-actions').boundingBox())!;
  expect(newButton.y).toBe(newMenu.y); expect(newButton.height).toBe(newMenu.height); expect(Math.abs(newButton.x + newButton.width - newMenu.x)).toBeLessThan(1);
  await expect(root.getByTestId('ssh-host-favorites')).toHaveCSS('border-radius', '999px');
  await page.setViewportSize({ width: 1240, height: 600 });
  const browser = root.getByTestId('ssh-host-browser'); const filters = root.locator('.ssh-host-filter-toolbar'); const folders = root.locator('.ssh-host-group-filters');
  const filterBefore = (await filters.boundingBox())!; const folderBefore = (await folders.boundingBox())!; const headerBefore = (await root.locator('header').boundingBox())!;
  await browser.evaluate(element => { element.scrollTop = 120; });
  const scroll = await browser.evaluate(element => element.scrollTop); expect(scroll).toBeGreaterThan(0);
  expect((await filters.boundingBox())!.y).toBeCloseTo(filterBefore.y - scroll, 0); expect((await folders.boundingBox())!.y).toBeCloseTo(folderBefore.y - scroll, 0);
  expect((await root.locator('header').boundingBox())!.y).toBe(headerBefore.y);
  await browser.evaluate(element => { element.scrollTop = 0; }); await page.setViewportSize({ width: 1240, height: 800 });
  const folder = root.locator('.ssh-host-group-filters > button').first();
  expect((await folder.boundingBox())!.height).toBeCloseTo(32, 0);
  await expect(row.locator('.sidebar-row-title > svg')).toHaveCSS('color', starColor);
  await row.click(); await expect(row).toHaveAttribute('data-active', 'true');
  for (const layout of ['table', 'cards']) {
    await page.getByRole('button', { name: layout === 'table' ? '表格视图' : '卡片视图', exact: true }).click();
    if (layout === 'cards') {
      const cards = root.locator('.ssh-dashboard-card');
      const columns = await root.locator('.ssh-dashboard-group-section').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      const first = (await cards.nth(0).boundingBox())!; const lastInRow = (await cards.nth(columns - 1).boundingBox())!; const nextRow = (await cards.nth(columns).boundingBox())!;
      expect(lastInRow.y).toBe(first.y); expect(nextRow.y).toBeGreaterThan(first.y);
      expect(first.height).toBeGreaterThanOrEqual(116); expect(first.height).toBeLessThanOrEqual(160);
    }
    await expect(row.locator(layout === 'table' ? '.sidebar-row-title > svg' : '.ssh-dashboard-card-title > svg')).toHaveCSS('color', starColor);
    await page.screenshot({ path: info.outputPath(`prototype-${theme}-${layout}.png`), animations: 'disabled' });
    await page.getByTestId('ssh-host-favorites').click();
    await expect(root.locator('[data-testid^="ssh-row-"]')).toHaveCount(4);
    await expect(page.getByTestId('ssh-host-favorites').locator('svg')).toHaveCSS('color', starColor);
    await page.getByTestId('ssh-host-favorites').click();
    for (const width of [560, 1240]) {
      await page.setViewportSize({ width, height: 860 });
      expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`prototype-${theme}-${layout}-${width}.png`), animations: 'disabled' });
    }
  }
  await page.getByTestId('ssh-host-tag-filter').click();
  const menu = page.getByRole('menu', { name: '主机标签', exact: true });
  const menuBounds = (await menu.boundingBox())!; const groupsBounds = (await root.locator('.ssh-host-group-filters').boundingBox())!;
  expect(groupsBounds.y).toBeGreaterThanOrEqual(menuBounds.y + menuBounds.height);
  await page.getByRole('menuitemcheckbox', { name: 'production', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(root.locator('[data-testid^="ssh-row-"]')).toHaveCount(4);
  await page.getByTestId('ssh-search').fill('not-a-host');
  const empty = page.getByText('无匹配连接', { exact: true }); await expect(empty).toBeVisible();
  const resultBounds = (await root.locator('.ssh-dashboard-grid').boundingBox())!; const emptyBounds = (await empty.boundingBox())!;
  expect(Math.abs(emptyBounds.y + emptyBounds.height / 2 - resultBounds.y - resultBounds.height / 2)).toBeLessThan(16);
});
