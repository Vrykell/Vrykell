import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByTestId('workspace-area-code').click();
  await expect(page.getByTestId('workspace-history-back')).toBeVisible();
});

test('back and forward step through visited workspaces and restore their content', async ({ page }) => {
  const back = page.getByTestId('workspace-history-back');
  const forward = page.getByTestId('workspace-history-forward');
  const current = (id: string) => page.getByTestId(`workspace-area-${id}`);
  await back.click();
  await expect(current('terminal')).toHaveAttribute('aria-current', 'page');
  await expect(back).toBeDisabled();

  await current('code').click();
  await current('ai').click();
  await expect(current('ai')).toHaveAttribute('aria-current', 'page');
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  await back.click();
  await expect(current('code')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await expect(forward).toBeEnabled();

  await back.click();
  await expect(current('terminal')).toHaveAttribute('aria-current', 'page');
  await expect(back).toBeDisabled();

  await forward.click();
  await expect(current('code')).toHaveAttribute('aria-current', 'page');
  await forward.click();
  await expect(current('ai')).toHaveAttribute('aria-current', 'page');
  await expect(forward).toBeDisabled();

  // A direct visit after stepping back replaces the abandoned forward branch.
  await back.click();
  await current('ssh').click();
  await expect(forward).toBeDisabled();
  await back.click();
  await expect(current('code')).toHaveAttribute('aria-current', 'page');
});

test('the trail and area anchor yield on narrow windows while the tab strip keeps a single row', async ({ page }) => {
  const header = page.locator('.workspace-titlebar');
  const back = page.getByTestId('workspace-history-back');
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect(back).toBeVisible();
  // The tab strip is portaled into the titlebar; content begins at the row's bottom edge.
  await expect(header.getByTestId('workspace-instance-bar').locator('.folder-header')).toHaveCount(1);
  const bar = (await header.boundingBox())!;
  const content = (await page.locator('.workspace-main').boundingBox())!;
  expect(Math.abs(content.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  // The area anchor appears only while the sidebar is collapsed.
  await expect(page.locator('.workspace-title span')).toHaveCount(0);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(page.locator('.workspace-title span')).toHaveText('项目文件');
  for (const width of [520, 480]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(back).toBeHidden();
    await expect(page.locator('.workspace-title span')).toBeHidden();
    await expect(page.getByTestId('global-search-trigger')).toBeVisible();
  }
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect(back).toBeVisible();
  await expect(page.locator('.workspace-title span')).toHaveText('项目文件');
});
