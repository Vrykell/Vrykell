import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function openUsage(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().openUsageTab();
  });
  await expect(page.getByTestId('usage-page')).toBeVisible();
}

async function tokenBackground(page: Page, token: string) {
  return page.evaluate(token => {
    const probe = document.createElement('span');
    probe.style.background = `var(${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, token);
}

for (const theme of ['dark', 'light'] as const) test(`unused configurations and neutral open dropdowns in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await openUsage(page);
  const modelFilter = page.getByTestId('usage-model-filter');
  await expect(modelFilter).toBeVisible();
  await modelFilter.click();
  const modelOption = page.getByRole('option', { name: 'qwen2.5' });
  await expect(modelOption.locator('svg')).toBeVisible();
  const iconBox = (await modelOption.locator('svg').boundingBox())!;
  const labelBox = (await modelOption.locator('.ui-select-option-label').boundingBox())!;
  expect(iconBox.x).toBeLessThan(labelBox.x);
  expect(iconBox.width).toBe(16);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid^="usage-source-"]')).toHaveCount(0);
  await expect(page.getByTestId('usage-clear')).toBeDisabled();
  await page.getByTestId('usage-tab-models').click();
  await expect(page.getByTestId('usage-model-row')).toHaveCount(2);
  await expect(page.locator('[data-testid="usage-model-row"][data-model="qwen2.5"]')).toContainText('0');
  await page.getByTestId('usage-tab-providers').click();
  await expect(page.getByTestId('usage-provider-row')).toHaveCount(2);

  const select = page.getByTestId('usage-range');
  const hoverBackground = await tokenBackground(page, '--button-hover');
  expect(new Set(hoverBackground.match(/[\d.]+/g)!.slice(0, 3)).size).toBe(1);
  await select.hover();
  await expect(select).toHaveCSS('background-color', hoverBackground);
  await select.click();
  await page.getByRole('option', { name: '全部时间', exact: true }).hover();
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await expect(select).toHaveCSS('background-color', hoverBackground);
  const active = page.getByRole('option', { name: '全部时间', exact: true });
  await expect(active).toHaveCSS('background-color', await tokenBackground(page, '--hover'));
  await page.screenshot({ path: info.outputPath(`usage-dropdown-${theme}.png`), animations: 'disabled' });
  await active.click();
  await page.mouse.move(0, 0);
  await expect(select).toHaveCSS('background-color', await tokenBackground(page, '--field-bg'));
  await modelFilter.click();
  await page.getByRole('option', { name: 'qwen2.5' }).click();
  await expect(modelFilter).toContainText('qwen2.5');
  await expect(page.getByTestId('usage-total-tokens')).toHaveText('0');
  await page.getByTestId('usage-tab-acp').click();
  await expect(page.getByTestId('usage-acp-row')).toContainText('Fake ACP');
  await expect(page.getByTestId('usage-acp-row')).toContainText('尚未上报用量');
  await expect(page.getByTestId('usage-clear')).toBeDisabled();
  await page.screenshot({ path: info.outputPath(`usage-unused-${theme}.png`), animations: 'disabled' });
  await page.setViewportSize({ width: 700, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(700);
  await page.screenshot({ path: info.outputPath(`usage-unused-narrow-${theme}.png`), animations: 'disabled' });
  await page.reload();
  await openUsage(page);
  await page.getByTestId('usage-model-filter').click();
  await expect(page.getByRole('option', { name: 'qwen2.5' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('usage-total-requests')).toHaveText('0');
});
