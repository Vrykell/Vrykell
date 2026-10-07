import { expect, type Page } from '@playwright/test';

/** 打开设置页（Cmd+,），等待侧栏就绪 */
export async function openSettings(page: Page): Promise<void> {
  // 先等应用挂载完（快捷键监听器就绪），避免按键丢失
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Meta+,');
  await expect(page.locator('aside')).toBeVisible({ timeout: 5000 });
}

/** 点击设置侧栏项进入某设置页（label 为侧栏按钮名，如「模型配置」「技能」） */
export async function gotoSetting(page: Page, label: string): Promise<void> {
  await openSettings(page);
  const nav = page.locator('aside');
  const item = nav.getByRole('button', { name: label, exact: true });
  if (await item.count() === 0) {
    // 分组默认折叠：先把所有分组展开再找目标项
    while (await nav.locator('button[aria-expanded="false"]').count() > 0) {
      await nav.locator('button[aria-expanded="false"]').first().click();
    }
  }
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
