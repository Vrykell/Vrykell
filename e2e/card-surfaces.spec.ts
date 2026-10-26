import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

function luminance(color: string) {
  const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const normalized = channels.map(channel => color.startsWith('color(') ? channel : channel / 255);
  return normalized.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

async function expectCards(cards: Locator, background: string) {
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS('background-color', background);
    await expect(card).toHaveCSS('border-width', '0px');
    await expect(card).toHaveCSS('box-shadow', 'none');
  }
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

for (const theme of ['dark', 'light'] as const) test(`cards share clear borderless surfaces and brighter hints in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { groupedHistoricalSession: true, sshWorkspaceView: 'dashboard' });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  const selectedNavigation = page.getByTestId('workspace-area-terminal');
  await expect(selectedNavigation.locator('.sidebar-row-content')).toHaveCSS('background-color', await tokenBackground(page, '--selection-bg'));
  await expect(selectedNavigation.locator('.sidebar-row-icon')).toHaveCSS('color', await tokenBackground(page, '--primary-action'));
  const selection = await tokenBackground(page, '--selection-bg');
  expect(new Set(selection.match(/[\d.]+/g)!.slice(0, 3)).size).toBe(1);
  await page.getByTestId('workspace-area-ai').hover();
  const navigationHover = await page.getByTestId('workspace-area-ai').locator('.sidebar-row-content').evaluate(element => getComputedStyle(element).backgroundColor);
  expect(new Set(navigationHover.match(/[\d.]+/g)!.slice(0, 3)).size).toBe(1);
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().openUsageTab();
  });
  await expect(page.getByTestId('usage-page')).toBeVisible();
  const background = await tokenBackground(page, '--card-bg');
  const canvas = await tokenBackground(page, '--canvas');
  expect(contrast(background, canvas)).toBeGreaterThanOrEqual(1.12);
  for (const token of ['--text-primary', '--text-secondary', '--text-muted']) {
    expect(contrast(background, await tokenBackground(page, token))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(await tokenBackground(page, '--card-hover-bg'), await tokenBackground(page, token))).toBeGreaterThanOrEqual(4.5);
  }
  await expectCards(page.locator('.usage-card'), background);
  await page.screenshot({ path: info.outputPath(`usage-${theme}.png`), animations: 'disabled' });

  await gotoSetting(page, '快捷键说明');
  await expectCards(page.locator('.settings-group-panel'), background);
  const hint = page.locator('.settings-shortcut-row .key-hint').first();
  await expect(hint).toHaveCSS('background-color', await tokenBackground(page, '--field-bg'));
  const hintColors = await hint.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color }));
  expect(luminance(hintColors.background)).toBeGreaterThan(luminance(background));
  expect(contrast(hintColors.background, hintColors.text)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath(`shortcuts-${theme}.png`), animations: 'disabled' });
  await page.locator('.settings-navigation').getByRole('button', { name: 'Zsh', exact: true }).click();
  await expectCards(page.locator('.shell-profile-page .settings-group-panel'), background);
  await page.screenshot({ path: info.outputPath(`settings-${theme}.png`), animations: 'disabled' });
  await page.getByTestId('workspace-settings').hover();
  const tooltip = page.getByTestId('app-tooltip');
  await expect(tooltip).toHaveCSS('background-color', await tokenBackground(page, '--field-bg'));
  await expect(tooltip.locator('.key-hint')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`shortcut-hint-${theme}.png`), animations: 'disabled' });
  await page.keyboard.press('Escape');

  await page.getByTestId('workspace-history').click();
  await expectCards(page.locator('.history-group-card'), background);
  const historyTitle = page.locator('.history-row .sidebar-row-title').first();
  await historyTitle.hover();
  await expect(historyTitle).toHaveCSS('color', await tokenBackground(page, '--history-link-color'));
  await expect(historyTitle).toHaveCSS('text-decoration-line', 'underline');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(`history-${theme}.png`), animations: 'disabled' });

  await page.getByTestId('workspace-area-ssh').click();
  await page.getByRole('button', { name: '卡片视图', exact: true }).click();
  const host = page.getByTestId('ssh-row-ssh-1');
  await page.mouse.move(0, 0);
  await expect(host).toHaveCSS('background-color', background);
  await expect(host).toHaveCSS('border-width', '1px');
  await expect(host).toHaveCSS('box-shadow', 'none');
  const bounds = (await host.boundingBox())!;
  await page.mouse.move(bounds.x + 14, bounds.y + bounds.height / 2);
  await expect(host).toHaveCSS('background-color', await tokenBackground(page, '--card-hover-bg'));
  const hovered = await host.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(theme === 'dark' ? luminance(hovered) > luminance(background) : luminance(hovered) < luminance(background)).toBe(true);
  await page.mouse.move(0, 0);
  await expect(host).toHaveCSS('background-color', background);
  await page.screenshot({ path: info.outputPath(`hosts-${theme}.png`), animations: 'disabled' });

  await page.getByTestId('workspace-area-ai').click();
  await expect(page.getByTestId('ai-start-new-conversation')).toBeVisible();
  await expectCards(page.locator('.ai-launch-option'), background);
  await page.getByTestId('ai-start-new-conversation').hover();
  await expect(page.getByTestId('ai-start-new-conversation')).not.toHaveCSS('background-color', background);
  await expect(page.getByTestId('acp-launcher-Fake ACP')).toHaveCSS('background-color', background);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(`ai-start-${theme}.png`), animations: 'disabled' });
  await page.getByTestId('workspace-history').click();
  await page.setViewportSize({ width: 700, height: 800 });
  await expectCards(page.locator('.history-group-card'), background);
  await page.screenshot({ path: info.outputPath(`history-narrow-${theme}.png`), animations: 'disabled' });
});
