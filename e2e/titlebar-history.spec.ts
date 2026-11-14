import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByTestId('workspace-history-back')).toBeVisible();
});

test('back and forward step through visited workspaces and restore their content', async ({ page }) => {
  const back = page.getByTestId('workspace-history-back');
  const forward = page.getByTestId('workspace-history-forward');
  const title = page.locator('.workspace-title span');
  await expect(back).toBeDisabled();

  await page.getByTestId('workspace-area-code').click();
  await page.getByTestId('workspace-area-ai').click();
  await expect(title).toHaveText('智能对话');
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  await back.click();
  await expect(title).toHaveText('项目文件');
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await expect(forward).toBeEnabled();

  await back.click();
  await expect(title).toHaveText('终端会话');
  await expect(back).toBeDisabled();

  await forward.click();
  await expect(title).toHaveText('项目文件');
  await forward.click();
  await expect(title).toHaveText('智能对话');
  await expect(forward).toBeDisabled();

  // A direct visit after stepping back replaces the abandoned forward branch.
  await back.click();
  await page.getByTestId('workspace-area-ssh').click();
  await expect(forward).toBeDisabled();
  await back.click();
  await expect(title).toHaveText('项目文件');
});

test('history actions fold away before they squeeze the title or collapse the search', async ({ page }) => {
  const header = page.locator('.workspace-titlebar');
  const back = page.getByTestId('workspace-history-back');
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect(header).toHaveAttribute('data-history', 'true');
  await expect(back).toBeVisible();

  for (const width of [520, 480]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => header.getAttribute('data-history')).toBe('false');
    await expect(back).toBeHidden();
    // The title keeps its readable width and the search keeps its centered position.
    const title = (await page.locator('.workspace-title span').boundingBox())!;
    expect(title.width).toBeGreaterThan(40);
    const search = (await page.getByTestId('global-search-trigger').boundingBox())!;
    const bar = (await header.boundingBox())!;
    expect(Math.abs(search.x + search.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(1);
  }

  await page.setViewportSize({ width: 1240, height: 800 });
  await expect.poll(() => header.getAttribute('data-history')).toBe('true');
  await expect(back).toBeVisible();
});
