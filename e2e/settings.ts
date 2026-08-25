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
  await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('section').getByText(label, { exact: true }).first()).toBeVisible({ timeout: 3000 });
}

/** 在设置页内按 Field 标题定位控件容器（标题 + 描述 + 控件） */
export function fieldOf(page: Page, title: string) {
  return page.locator('section').locator('div').filter({ has: page.getByText(title, { exact: true }) }).first();
}
