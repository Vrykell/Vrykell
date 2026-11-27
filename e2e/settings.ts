import { expect, type Page } from '@playwright/test';
import { waitForWorkbench } from './tauri-mock';

export async function selectThemeMode(page: Page, label: string): Promise<void> {
  const name = label === '深色' ? '始终深色' : label === '浅色' ? '始终浅色' : label;
  await page.getByRole('radiogroup', { name: '主题模式' }).getByRole('radio', { name, exact: true }).click();
}

/** Open settings and wait for the static navigation. */
export async function openSettings(page: Page): Promise<void> {
  await waitForWorkbench(page);
  if (!(await page.locator('.settings-view').isVisible())) {
    const settings = page.getByRole('button', { name: '设置', exact: true });
    if (await settings.isVisible()) await settings.click();
    else await page.keyboard.press('Control+,');
  }
  await expect(page.locator('.settings-view')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.settings-navigation')).toBeVisible();
}

/** Select a settings page by its navigation label. */
export async function gotoSetting(page: Page, label: string): Promise<void> {
  await openSettings(page);
  const nav = page.locator('aside');
  if (['Zsh', 'Bash', 'Windows PowerShell', 'PowerShell 7', 'CMD'].includes(label)) {
    await nav.getByRole('button', { name: 'Shell 配置文件', exact: true }).click();
    const picker = page.getByRole('combobox', { name: 'Shell 配置文件', exact: true });
    if ((await picker.textContent())?.trim() !== label) {
      await picker.click();
      await page.getByRole('option', { name: label, exact: true }).click();
    }
    await expect(picker).toHaveText(label);
    return;
  }
  const item = nav.getByRole('button', { name: label, exact: true });
  await item.click();
  await expect(page.locator('section').getByText(label, { exact: true }).first()).toBeVisible({ timeout: 3000 });
}

/** Locate a control container inside the settings page by its field title (the field div holding the title). */
export function fieldOf(page: Page, title: string) {
  return page.locator('section').getByText(title, { exact: true }).first().locator('xpath=..');
}

/** Locate a row by its inline text (the parent div of the text element). */
export function rowOf(page: Page, text: string) {
  return page.locator('section').getByText(text, { exact: true }).first().locator('xpath=..');
}
