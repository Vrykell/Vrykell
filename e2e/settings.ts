import { expect, type Page } from '@playwright/test';

/** Open settings and wait for the static navigation. */
export async function openSettings(page: Page): Promise<void> {
  // Wait for shortcut listeners before opening settings.
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Meta+,');
  await expect(page.locator('aside')).toBeVisible({ timeout: 5000 });
}

/** Select a settings page by its navigation label. */
export async function gotoSetting(page: Page, label: string): Promise<void> {
  await openSettings(page);
  const nav = page.locator('aside');
  const item = nav.getByRole('button', { name: label, exact: true });
  await item.click();
  await expect(page.locator('section').getByText(label, { exact: true }).first()).toBeVisible({ timeout: 3000 });
}

/** 在设置页内按 Field 标题定位控件容器（标题所在的 Field div） */
export function fieldOf(page: Page, title: string) {
  return page.locator('section').getByText(title, { exact: true }).first().locator('xpath=..');
}

/** 按行内文本定位一行（文本元素的父级 div） */
export function rowOf(page: Page, text: string) {
  return page.locator('section').getByText(text, { exact: true }).first().locator('xpath=..');
}
