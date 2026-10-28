import { expect, type Page } from '@playwright/test';
import { waitForWorkbench } from './tauri-mock';

/** Open an existing resource through the common workspace's explicit picker. */
export async function openWorkspaceResource(page: Page, title?: string): Promise<void> {
  await waitForWorkbench(page);
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '全部工作区标签', exact: true }).click();
  const menu = page.getByRole('menu', { name: '全部工作区标签' });
  await expect(menu).toBeVisible();
  await (title ? menu.getByRole('menuitem', { name: title, exact: true }) : menu.getByRole('menuitem').first()).click();
}

/** Open domain actions from the strip's unused area. */
export async function openWorkspaceActions(page: Page): Promise<void> {
  const track = page.getByTestId('workspace-instance-bar').locator('.folder-tab-list:visible').first();
  const bounds = (await track.boundingBox())!;
  await track.evaluate((element, point) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...point })),
    { clientX: bounds.x + 8, clientY: bounds.y + bounds.height });
}

export async function chooseSplitType(page: Page, label: string): Promise<void> {
  const bar = page.getByTestId('workspace-instance-bar');
  await bar.locator('.folder-tab[data-active="true"]:visible').first().click({ button: 'right' });
  await page.getByRole('menu', { name: '标签页操作', exact: true }).getByText('拆分标签页', { exact: true }).hover();
  await page.getByRole('menu', { name: '拆分标签页', exact: true }).getByText(label, { exact: true }).click();
}
