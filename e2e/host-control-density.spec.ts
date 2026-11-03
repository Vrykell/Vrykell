import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.use({ deviceScaleFactor: 1.25, viewport: { width: 1024, height: 640 } });
for (const theme of ['dark', 'light']) test(`host controls retain compact prototype dimensions at display scaling in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('workspace-navigation-v1', JSON.stringify({ collapsed: true }));
    localStorage.setItem('vrykell-host-library', JSON.stringify({ state: { hosts: { 'ssh-1': { group: 'topview', tags: ['production'], starred: true } } }, version: 0 }));
  }, theme);
  await page.goto('/'); await page.evaluate(() => { document.documentElement.dataset.nativeMaterial = 'fallback'; });
  await page.getByTestId('workspace-sidebar-expand').click();
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('workspace-sidebar-toggle').click();
  await expect(page.locator('.workspace-titlebar [data-connection-panel]')).toHaveCount(0);
  const root = page.getByTestId('ssh-dashboard');
  const folder = root.getByTestId('ssh-host-group-filter');
  await expect(folder).toHaveCSS('border-top-width', '0px');
  await expect(folder).toHaveCSS('background-color', await root.evaluate(element => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--card-bg)'; element.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color;
  }));
  const scale = await page.evaluate(() => window.devicePixelRatio);
  expect((await folder.boundingBox())!.height * scale).toBeCloseTo(35, 0);
  expect((await root.getByTestId('ssh-new-btn').boundingBox())!.height * scale).toBeCloseTo(35, 0);
  expect((await root.getByTestId('ssh-host-favorites').boundingBox())!.height * scale).toBeCloseTo(35, 0);
  expect((await root.getByRole('switch', { name: '资源占用' }).boundingBox())!.height * scale).toBeCloseTo(22.5, 0);
  const row = root.getByTestId('ssh-row-ssh-1').locator('.sidebar-row-content');
  await expect(row).toHaveCSS('border-bottom-width', '0px');
  expect((await row.boundingBox())!.height * scale).toBeCloseTo(50, 0);
  await folder.click();
  const groupMenu = page.getByRole('menu', { name: '主机分组', exact: true });
  expect((await groupMenu.boundingBox())!.width).toBeCloseTo(180, 0);
  const option = page.getByRole('menuitemcheckbox', { name: 'topview', exact: true });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await expect(option.locator('input')).toHaveCount(0);
  await expect(root.getByRole('heading', { name: 'topview', level: 2 })).toBeVisible();
  await expect(root.locator('.ssh-host-page-title')).toContainText('1 台主机');
  await option.click();
  await expect(root.getByRole('heading', { name: '主机', level: 2 })).toBeVisible();
  await page.keyboard.press('Escape');
  await root.getByTestId('ssh-host-tag-filter').click();
  const tagMenu = page.getByRole('menu', { name: '主机标签', exact: true });
  expect((await tagMenu.boundingBox())!.width).toBeCloseTo(180, 0);
  const tagBounds = (await tagMenu.boundingBox())!;
  const tagTrigger = (await root.getByTestId('ssh-host-tag-filter').boundingBox())!;
  expect(tagBounds.x).toBeCloseTo(Math.max(8, tagTrigger.x + tagTrigger.width - tagBounds.width), 0);
  await page.screenshot({ path: info.outputPath(`host-density-${theme}-125.png`), animations: 'disabled' });
});

for (const theme of ['dark', 'light']) test(`long host group headings fit narrow and wide layouts in ${theme}`, async ({ page }, info) => {
  const group = 'Production infrastructure and database servers across all regions';
  await setupTauriMock(page, {});
  await page.addInitScript(({ theme, group }) => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('vrykell-host-library', JSON.stringify({ state: { hosts: { 'ssh-1': { group, tags: ['production'], starred: false } } }, version: 0 }));
  }, { theme, group });
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  const root = page.getByTestId('ssh-dashboard');
  await root.getByTestId('ssh-host-group-filter').click();
  const option = page.getByRole('menuitemcheckbox', { name: group, exact: true });
  await option.focus();
  await page.keyboard.press('Enter');
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '主机分组', exact: true })).toHaveCount(0);
  const heading = root.getByRole('heading', { name: group, level: 2 });
  await expect(heading).toHaveAttribute('data-tip', group);
  for (const width of [560, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(heading).toBeVisible();
    const header = root.locator('.ssh-host-page-header');
    expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await heading.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(root.getByTestId('ssh-new-btn')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`host-group-${theme}-${width}.png`), animations: 'disabled' });
    await root.getByTestId('ssh-forwarding-entry').click();
    const forwarding = page.getByTestId('port-forwarding-page');
    const breadcrumb = forwarding.getByRole('navigation', { name: '页面导航' });
    const back = breadcrumb.getByRole('button', { name: group, exact: true });
    await expect(back).toHaveAttribute('data-tip', group);
    await expect(breadcrumb.getByRole('heading', { name: '端口转发', level: 2 })).toBeVisible();
    expect(await forwarding.locator('header').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(forwarding.getByRole('button', { name: '添加转发…' })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`forwarding-group-${theme}-${width}.png`), animations: 'disabled' });
    await back.click();
    await expect(heading).toBeVisible();
    await expect(root.getByTestId('ssh-row-ssh-1')).toBeVisible();
  }
  await root.getByTestId('ssh-host-group-filter').click();
  await page.getByRole('menuitemcheckbox', { name: group, exact: true }).click();
  await page.keyboard.press('Escape');
  await root.getByTestId('ssh-forwarding-entry').click();
  await expect(page.getByTestId('port-forwarding-page').getByRole('button', { name: '主机', exact: true })).toBeVisible();
});
