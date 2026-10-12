import { expect, test } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';

test('settings and history are visible singleton tabs with switching, filtering and closing', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
  await page.keyboard.press('Meta+,');
  const settings = page.locator('[data-tab-kind="settings"]');
  await expect(settings).toHaveCount(1);
  await expect(settings).toBeVisible();
  await expect(settings.locator('[data-navigation-mark="settings"]')).toBeVisible();
  await page.keyboard.press('Meta+,');
  await expect(settings).toHaveCount(1);
  await page.getByTestId('tab-history-btn').click();
  const history = page.locator('[data-tab-kind="history"]');
  await expect(history).toHaveCount(1);
  await expect(history).toBeVisible();
  await expect(history.locator('[data-navigation-mark="history"]')).toBeVisible();
  for (const mark of ['settings', 'history']) {
    const geometry = await page.locator(`[data-navigation-mark="${mark}"]`).evaluate(element => {
      const tile = element.getBoundingClientRect();
      const glyph = element.querySelector('svg')!.getBoundingClientRect();
      return { dx: Math.abs(tile.x + tile.width / 2 - glyph.x - glyph.width / 2),
        dy: Math.abs(tile.y + tile.height / 2 - glyph.y - glyph.height / 2),
        fits: glyph.x > tile.x && glyph.y > tile.y && glyph.right < tile.right && glyph.bottom < tile.bottom };
    });
    expect(geometry.dx).toBeLessThan(1);
    expect(geometry.dy).toBeLessThan(1);
    expect(geometry.fits).toBe(true);
  }
  await page.getByTestId('tab-history-btn').click();
  await expect(history).toHaveCount(1);
  await settings.click();
  await expect(page.locator('aside')).toBeVisible();
  await settings.click({ button: 'right' });
  await expect(page.getByRole('button', { name: '复制会话', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await history.click();
  await expect(page.getByTestId('session-filter-input')).toBeVisible();
  await page.getByTestId('tab-search').fill('设置');
  await expect(settings).toBeVisible();
  await expect(history).toHaveCount(0);
  await page.getByTestId('tab-search').fill('');
  await history.getByRole('button', { name: '关闭标签', exact: true }).click();
  await expect(history).toHaveCount(0);
  await page.getByTestId('tab-history-btn').click();
  await expect(history).toHaveCount(1);
});

test('local and SSH tabs retain colored tiles before and after activation', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().addTab({ shellType: 'bash', title: 'Local test' });
    useWorkspaceStore.getState().addTab({ kind: 'ssh', title: 'Remote test', ssh: { name: 'Remote test', host: 'example.invalid' } });
  });
  for (const [label, mark] of [['Local test', 'bash'], ['Remote test', 'ssh']]) {
    const row = page.locator('[data-tab-row-id]').filter({ hasText: label });
    const icon = row.locator('svg').first();
    await expect(icon).toHaveAttribute('data-shell-mark', mark);
    const badge = icon.locator('..');
    await expect(badge).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(badge).toHaveCSS('width', '20px');
    await expect(badge).toHaveCSS('height', '20px');
    await expect(icon).toHaveAttribute('style', new RegExp(`color: var\\(--shell-${mark}-accent\\)`));
    const color = await icon.evaluate(element => getComputedStyle(element).color);
    await row.click();
    await expect(icon).toHaveCSS('color', color);
  }
});

test('group folder colors stay distinct and stable across reorder and restoration in both themes', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
  const seed = async () => page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.setState({ groups: Array.from({ length: 6 }, (_, index) => ({
      id: `group-${index}`, title: `Group ${index}`, collapsed: false,
    })) });
    useWorkspaceStore.getState().openSettingsTab();
    useWorkspaceStore.getState().openHistoryTab();
  });
  await seed();
  const colors = async () => page.locator('[data-navigation-mark="group"]').evaluateAll(elements =>
    Object.fromEntries(elements.map(element => [element.closest('[data-group-header-id]')!.getAttribute('data-group-header-id'),
      { token: element.getAttribute('data-group-color'), color: getComputedStyle(element).color }])));
  const original = await colors();
  expect(Object.keys(original)).toHaveLength(6);
  expect(new Set(Object.values(original).map(value => value.color)).size).toBe(6);
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.setState(state => ({ groups: [...state.groups].reverse().map(group => ({ ...group, title: `Renamed ${group.id}` })) }));
  });
  expect(await colors()).toEqual(original);
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async value => {
      const path = '/src/config/theme/tokens.ts';
      const { applyTheme } = await import(path) as typeof import('../src/config/theme/tokens');
      applyTheme(value);
    }, theme);
    const themed = await colors();
    expect(new Set(Object.values(themed).map(value => value.color)).size).toBe(6);
    for (const id of Object.keys(original)) expect(themed[id]!.token).toBe(original[id]!.token);
    const shading = await page.locator('[data-navigation-mark="group"]').evaluateAll(elements => elements.map(element => ({
      gradientId: element.querySelector('linearGradient')!.id,
      stops: [...element.querySelectorAll('stop')].map(stop => getComputedStyle(stop).stopColor),
      paper: !!element.querySelector('rect[fill="var(--navigation-group-paper)"]'),
    })));
    expect(new Set(shading.map(item => item.gradientId)).size).toBe(6);
    for (const item of shading) {
      expect(new Set(item.stops).size).toBe(3);
      expect(item.paper).toBe(true);
    }
    await expect(page.locator('[data-navigation-mark="settings"] linearGradient, [data-navigation-mark="history"] linearGradient')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`colored-navigation-${theme}.png`) });
  }
  await page.reload();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
  await seed();
  for (const [id, value] of Object.entries(await colors())) expect(value.token).toBe(original[id]!.token);
});
