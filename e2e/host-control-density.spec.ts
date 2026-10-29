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
  const option = page.getByRole('menuitemcheckbox', { name: 'topview', exact: true });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await expect(option.locator('input')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`host-density-${theme}-125.png`), animations: 'disabled' });
});
