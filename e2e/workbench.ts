import { expect, type Page } from '@playwright/test';
import { waitForWorkbench } from './tauri-mock';

/** Open an existing resource through the common workspace's explicit picker. */
export async function openWorkspaceResource(page: Page, title?: string): Promise<void> {
  await waitForWorkbench(page);
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  const menu = page.getByRole('menu', { name: '全部工作区标签' });
  await expect(menu).toBeVisible();
  await (title ? menu.getByRole('menuitem', { name: title, exact: true }) : menu.getByRole('menuitem').first()).click();
}
