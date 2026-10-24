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
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await openUsage(page);
  await expect(page.getByTestId('usage-model-all')).toBeVisible();
  await expect(page.getByTestId('usage-model-qwen2.5')).toBeVisible();
  await expect(page.getByTestId('usage-filter-model')).toHaveCount(0);
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
  await page.getByTestId('usage-model-qwen2.5').click();
  await expect(page.getByTestId('usage-model-qwen2.5')).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.getByTestId('usage-model-qwen2.5')).toBeVisible();
  await expect(page.getByTestId('usage-total-requests')).toHaveText('0');
});
