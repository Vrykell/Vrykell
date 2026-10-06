import { test, expect, type Locator } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('small action buttons have readable targets and tab close works from the keyboard', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const size = async (button: Locator, minimum = 32) => {
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(minimum);
    expect(bounds!.height).toBeGreaterThanOrEqual(minimum);
  };
  await size(page.getByTestId('tab-new-btn'));
  await size(page.getByTestId('tab-history-btn'));
  await size(page.getByRole('button', { name: '关闭标签面板', exact: true }));
  await size(page.getByRole('button', { name: '设置', exact: true }));
  await page.getByTestId('tab-new-btn').click();
  await page.getByText('Zsh', { exact: true }).click();
  const row = page.locator('[data-tab-row-id]').last();
  // 标签行按 shell 显示品牌图标：从弹窗选择 Zsh → 行内出现 zsh 标记
  await expect(row.locator('[data-shell-mark="zsh"]')).toBeVisible();
  const close = row.getByRole('button', { name: '关闭标签', exact: true });
  await size(close, 28);
  await close.press('Enter');
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(1);
  await page.locator('[data-dock-btn="chat"]').click();
  const chat = page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]');
  await size(chat.locator('button[title^="添加附件"]'));
  await size(chat.locator('button[title^="发送"]'));
  await page.screenshot({ path: test.info().outputPath('readable-actions.png'), animations: 'disabled' });
});

test('workspace icons remain readable and fit inside their controls', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const checkSize = async (icon: Locator, size: number) => {
    await expect(icon).toBeVisible();
    const bounds = await icon.boundingBox();
    expect(bounds?.width).toBe(size);
    expect(bounds?.height).toBe(size);
  };
  const checkFits = async (icon: Locator) => {
    expect(await icon.evaluate(svg => {
      const glyph = svg.getBoundingClientRect();
      const button = svg.closest('button')!.getBoundingClientRect();
      return glyph.left >= button.left && glyph.top >= button.top &&
        glyph.right <= button.right && glyph.bottom <= button.bottom;
    })).toBe(true);
  };
  const nav = page.locator('[data-dock-btn="tabs"] svg');
  await checkSize(nav, 24);
  await checkFits(nav);
  const aiButton = page.locator('[data-dock-btn="chat"]');
  await expect(aiButton).toHaveClass('activity-button');
  await expect(aiButton).toHaveText('');
  await checkSize(aiButton.locator('svg'), 24);
  await checkFits(aiButton.locator('svg'));
  expect(await aiButton.boundingBox()).toMatchObject({ width: 32, height: 32 });
  await checkSize(page.locator('[data-tab-row-id] svg').first(), 20);
  const search = page.getByTestId('global-search-trigger').locator('svg');
  await checkSize(search, 18);
  await checkFits(search);
  const settings = page.locator('.workspace-settings svg');
  await checkSize(settings, 24);
  await checkFits(settings);
  await page.locator('[data-dock-btn="ssh"]').click();
  await checkSize(page.getByTestId('ssh-row-ssh-1').locator('svg').first(), 20);
  await page.locator('[data-dock-btn="chat"]').click();
  const chat = page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]');
  const attachment = chat.locator('button[title^="添加附件"] svg');
  await checkSize(attachment, 18);
  await checkFits(attachment);
  await page.screenshot({ path: test.info().outputPath('workspace-icons.png'), animations: 'disabled' });
});

test('workspace and settings use the same themed icon family in both themes', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const nav = page.locator('[data-dock-btn="tabs"] svg');
  await expect(nav).toHaveAttribute('data-fui-icon');
  await expect(nav).toHaveAttribute('fill', 'currentColor');
  await gotoSetting(page, '主题');
  const header = page.locator('.settings-content > div').first().locator('svg');
  for (const theme of ['深色', '浅色']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(header).toHaveAttribute('data-fui-icon');
    await expect(header).toHaveAttribute('viewBox', '0 0 24 24');
    await expect(header).toHaveAttribute('fill', 'currentColor');
    await expect(header).toHaveAttribute('aria-hidden', 'true');
    const foreground = await header.evaluate(element => getComputedStyle(element).color);
    expect(foreground).toBe(await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--text-muted)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }));
    await page.getByRole('combobox', { name: '页面字号' }).click();
    await expect(page.getByRole('combobox', { name: '页面字号' }).locator('svg')).toHaveAttribute('data-fui-icon');
    await expect(page.locator('svg.lucide, svg.tabler-icon')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`icons-${theme}.png`), animations: 'disabled' });
    await page.getByRole('combobox', { name: '页面字号' }).press('Escape');
  }
});
