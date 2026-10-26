import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.use({ deviceScaleFactor: 1.25 });
for (const theme of ['dark', 'light']) test(`aligned host columns, inline states and neutral cards in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/'); await page.getByTestId('workspace-area-ssh').click();
  const root = page.getByTestId('ssh-dashboard');
  await expect(root.getByTestId('ssh-row-ssh-1')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/ssh/stores/store.ts';
    const { useSshStore } = await import(path) as typeof import('../src/features/ssh/stores/store');
    for (const [id, name] of [['auth', 'Authentication'], ['offline', 'Offline']]) await useSshStore.getState().save({ id, name, host: `${id}.test`, user: 'ops', authMethod: 'password' });
    (window as unknown as Record<string, unknown>).__SSH_STATUS_BY_HOST__ = { auth: { error: 'SSH_AUTH_FAILED: rejected' }, offline: { error: 'Connection refused' } };
    document.documentElement.dataset.nativeMaterial = 'fallback';
  });
  await root.getByRole('switch', { name: '资源占用' }).click();
  await expect(root.getByTestId('ssh-row-auth')).toContainText('登录失败');
  const offline = root.getByTestId('ssh-row-offline'); await expect(offline).toContainText('离线');
  await expect(root.locator('.ssh-host-columns')).toHaveText('名称状态CPU内存磁盘');
  await expect(root.locator('.sidebar-row-subtitle')).toHaveCount(0);
  for (const row of await root.locator('.sidebar-row-content').all()) {
    const cells = row.locator('.ssh-dashboard-metric');
    for (let index = 0; index < 3; index++) {
      const header = (await root.locator('.ssh-host-columns > span').nth(index + 3).boundingBox())!;
      const cell = (await cells.nth(index).boundingBox())!;
      expect(cell.x).toBeCloseTo(header.x, 0); expect(cell.width).toBeCloseTo(header.width, 0);
      const headingLeft = await root.locator('.ssh-host-columns > span').nth(index + 3).evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect().left; });
      expect(headingLeft).toBeCloseTo(cell.x, 0);
      if (await cells.nth(index).locator('i').count()) expect((await cells.nth(index).locator('i').boundingBox())!.x).toBeCloseTo(headingLeft, 0);
    }
  }
  const numberGap = await root.getByTestId('ssh-row-ssh-1').locator('.ssh-dashboard-metric').nth(1).evaluate(element => { const bar = element.querySelector('i')!.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(element.querySelector('strong')!); return range.getBoundingClientRect().left - bar.right; });
  expect(numberGap).toBeGreaterThanOrEqual(5); expect(numberGap).toBeLessThanOrEqual(7);
  await expect(offline.locator('.ssh-dashboard-metric i')).toHaveCount(0);
  for (let index = 0; index < 3; index++) {
    const dashCenter = await offline.locator('.ssh-dashboard-metric').nth(index).evaluate(element => {
      const value = element.querySelector('strong')!; const range = document.createRange(); range.selectNodeContents(value);
      const text = range.getBoundingClientRect(); return (text.left + text.right) / 2;
    });
    const headingCenter = await root.locator('.ssh-host-columns > span').nth(index + 3).evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect(); return (text.left + text.right) / 2; });
    expect(dashCenter).toBeCloseTo(headingCenter, 0);
  }
  await root.getByTestId('ssh-dashboard-metrics').click();
  await page.getByRole('menu', { name: '采集并显示' }).getByTestId('ssh-dashboard-refresh').click();
  await expect(root.getByTestId('ssh-row-ssh-1').locator('.ssh-dashboard-metric').first().locator('i')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`host-table-aligned-${theme}.png`) });
  const columnsBox = (await root.locator('.ssh-host-columns').boundingBox())!;
  const firstMetric = (await root.locator('.ssh-host-columns > span').nth(3).boundingBox())!; const lastMetric = (await root.locator('.ssh-host-columns > span').nth(5).boundingBox())!;
  await page.screenshot({ path: info.outputPath(`host-metrics-${theme}.png`), clip: { x: firstMetric.x, y: columnsBox.y, width: lastMetric.x + lastMetric.width - firstMetric.x, height: 180 } });
  await root.getByTestId('ssh-row-ssh-1').hover();
  await expect(page.getByTestId('app-tooltip')).toContainText('root@prod.example.com:22');
  await root.getByTestId('ssh-row-ssh-1').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  for (const name of ['复制主机', '复制地址', '不读取资源占用', '重试']) await expect(menu.getByText(name, { exact: true })).toBeVisible();
  await expect(menu.getByText('查看详情', { exact: true })).toHaveCount(0); await expect(menu.locator('svg')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`host-menu-${theme}.png`) });
  await page.keyboard.press('Escape'); await root.getByTestId('ssh-row-ssh-1').focus(); await page.keyboard.press('Space'); await expect(page.getByRole('dialog', { name: '主机详情' })).toContainText('root@prod.example.com:22'); await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath(`host-table-${theme}.png`) });
  await root.getByRole('button', { name: '卡片视图' }).click(); await offline.click();
  const neutral = await offline.evaluate(element => { const sample = document.createElement('div'); sample.style.backgroundColor = 'var(--card-hover-bg)'; element.appendChild(sample); const color = getComputedStyle(sample).backgroundColor; sample.remove(); return color; });
  await expect.poll(() => offline.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(neutral);
  await page.screenshot({ path: info.outputPath(`host-cards-${theme}.png`) });
  const cardMetrics = root.getByTestId('ssh-row-ssh-1').locator('.ssh-dashboard-metric');
  for (const bar of await cardMetrics.locator('i').all()) {
    const bounds = (await bar.boundingBox())!; const row = (await bar.locator('..').boundingBox())!;
    expect(bounds.height).toBe(6); expect(bounds.width / row.width).toBeCloseTo(.48, 1); expect(bounds.width).toBeLessThanOrEqual(180);
  }
  await expect(offline.locator('.ssh-host-last-connected')).toHaveCount(0);
  const header = (await root.locator('.ssh-host-page-header').boundingBox())!;
  await root.getByTestId('ssh-forwarding-entry').click(); const forwarding = page.getByTestId('port-forwarding-page');
  const fonts = await forwarding.locator('.ssh-forwarding-breadcrumb').evaluate(element => [getComputedStyle(element.querySelector('button')!).fontSize, getComputedStyle(element.querySelector('h2')!).fontSize]);
  expect(fonts).toEqual(['24px', '24px']);
  const nextHeader = (await forwarding.locator('.ssh-host-page-header').boundingBox())!; expect(nextHeader.x).toBe(header.x); expect(nextHeader.width).toBe(header.width);
  await forwarding.getByRole('button', { name: '主机', exact: true }).click(); await expect(root).toBeVisible();
  await page.setViewportSize({ width: 780, height: 620 });
  await root.getByRole('button', { name: '表格视图' }).click();
  for (const row of await root.locator('.sidebar-row-content').all()) expect((await row.boundingBox())!.height).toBeLessThanOrEqual(42);
  for (let index = 0; index < 3; index++) {
    const heading = (await root.locator('.ssh-host-columns > span').nth(index + 3).boundingBox())!;
    const value = (await offline.locator('.ssh-dashboard-metric').nth(index).boundingBox())!;
    expect(value.x).toBeCloseTo(heading.x, 0);
  }
  await root.getByTestId('ssh-dashboard-metrics').click();
  const metricMenu = page.getByRole('menu', { name: '采集并显示' }); const menuBox = (await metricMenu.boundingBox())!;
  const refreshBox = (await metricMenu.getByTestId('ssh-dashboard-refresh').boundingBox())!;
  expect(refreshBox.x).toBeCloseTo(menuBox.x + 4, 0); expect(refreshBox.width).toBeCloseTo(menuBox.width - 8, 0);
  await page.keyboard.press('Escape'); await root.getByRole('switch', { name: '资源占用' }).click();
  await expect(root.locator('.ssh-host-columns')).toHaveText('名称地址标签最近连接');
  await expect(root.getByTestId('ssh-row-ssh-1').locator('.sidebar-row-subtitle')).toContainText('root@prod.example.com:22');
  for (const [index, selector] of [[1, '.sidebar-row-title'], [2, '.sidebar-row-subtitle'], [3, '.ssh-host-tags'], [4, '.ssh-host-row-last-connected']] as const) {
    const heading = (await root.locator('.ssh-host-columns > span').nth(index).boundingBox())!;
    const value = (await root.getByTestId('ssh-row-ssh-1').locator(selector).boundingBox())!; expect(value.x).toBeCloseTo(heading.x, 0);
  }
  await page.screenshot({ path: info.outputPath(`host-metadata-${theme}.png`) });
});

test('host context actions copy, duplicate, exclude collection and confirm removal', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/'); await page.getByTestId('workspace-area-ssh').click();
  const root = page.getByTestId('ssh-dashboard'); const host = root.getByTestId('ssh-row-ssh-1');
  await host.click({ button: 'right' }); await page.getByRole('menu').getByText('复制地址', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__CLIPBOARD_TEXT__)).toBe('root@prod.example.com:22');
  await host.click({ button: 'right' }); await page.getByRole('menu').getByText('复制主机', { exact: true }).click();
  await expect(root.locator('.sidebar-row')).toHaveCount(2); await expect(root).toContainText('生产服务器 副本');
  await host.click({ button: 'right' }); await page.getByRole('menu').getByText('不读取资源占用', { exact: true }).click();
  await root.getByRole('switch', { name: '资源占用' }).click(); await expect(host).toContainText('未采集');
  await host.click({ button: 'right' }); await page.getByRole('menu').getByText('读取资源占用', { exact: true }).click(); await expect(host).toContainText('在线');
  await host.click({ button: 'right' }); await page.getByRole('menu').getByText('删除', { exact: true }).click();
  await page.getByTestId('confirm-cancel').click(); await expect(host).toBeVisible();
  await host.click({ button: 'right' }); await page.getByRole('menu').getByText('删除', { exact: true }).click(); await page.getByTestId('confirm-ok').click(); await expect(host).toHaveCount(0);
});

test('the contextual titlebar action opens and closes resources for the current remote terminal', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/'); await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  const resources = page.getByRole('button', { name: 'SSH 资源面板', exact: true });
  await resources.click(); await expect(page.getByTestId('ssh-status-panel')).toContainText('Linux 6.8');
  await expect(resources).toHaveAttribute('aria-pressed', 'true'); await resources.click(); await expect(page.getByTestId('ssh-status-panel')).toHaveCount(0);
});
