import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

const bar = (page: Page) => page.locator('[data-testid="workspace-instance-bar"]:visible');
const rows = (page: Page, scope: string) => bar(page).locator(`[data-workspace-scope="${scope}"]`);
async function createTwo(page: Page, scope: string) {
  await page.getByTestId(`workspace-area-${scope}`).click();
  if (scope === 'terminal') { await expect(rows(page, scope)).toHaveCount(1); await page.getByTestId('tab-new-default').click(); }
  else if (scope === 'ai') { await page.getByTestId('ai-new-conversation').click(); await page.getByTestId('ai-new-conversation').click(); }
  else if (scope === 'code') { await bar(page).getByRole('button', { name: '新建文件', exact: true }).click(); await bar(page).getByRole('button', { name: '新建文件', exact: true }).click(); }
  else {
    await expect(rows(page, scope)).toHaveCount(1);
    for (let index = 0; index < 2; index++) {
      await bar(page).getByRole('button', { name: '新建工作区标签', exact: true }).click();
      await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
    }
  }
  await expect(rows(page, scope)).toHaveCount(2);
}

for (const scope of ['terminal', 'code', 'ai', 'unified']) for (const theme of ['dark', 'light']) test(`uses shared groups and deletes every member in ${scope} in ${theme}`, async ({ page }, info) => {
  test.setTimeout(60_000);
  await setupTauriMock(page); await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/'); await createTwo(page, scope);
  const ids = await rows(page, scope).evaluateAll(elements => elements.map(element => element.getAttribute('data-tab-row-id')!));
  await rows(page, scope).first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  const title = `Foundation ${scope}`;
  await page.getByRole('textbox', { name: '分组名称', exact: true }).fill(title);
  await page.getByRole('textbox', { name: '分组名称', exact: true }).press('Enter');
  const header = bar(page).getByRole('button', { name: title, exact: true });
  await expect(header).toBeVisible();
  await bar(page).locator(`[data-tab-row-id=${JSON.stringify(ids[1])}]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移至标签组', exact: true }).hover();
  await page.getByRole('button', { name: title, exact: true }).last().click();
  const group = header.locator('xpath=../..');
  await expect(group.locator('[data-workspace-scope]')).toHaveCount(2);
  await header.click(); await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(group.locator('[data-workspace-scope]')).toHaveCount(0);
  await header.press('Space'); await expect(header).toHaveAttribute('aria-expanded', 'true');
  await header.click({ button: 'right' });
  await page.locator('.history-palette-swatch[data-color="rose"]').click();
  await expect(group).toHaveAttribute('data-group-color', 'rose');
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(header).toBeVisible();
    await page.screenshot({ path: info.outputPath(`group-${scope}-${theme}-${width}.png`) });
  }
  await header.click({ button: 'right' }); await page.getByRole('button', { name: '删除标签组', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除标签组', exact: true });
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(rows(page, scope)).toHaveCount(2);
  await header.click({ button: 'right' }); await page.getByRole('button', { name: '删除标签组', exact: true }).click();
  await confirm.getByRole('button', { name: '删除分组', exact: true }).click();
  await expect(rows(page, scope)).toHaveCount(scope === 'unified' ? 1 : 0); await expect(header).toHaveCount(0);
  if (scope === 'unified') await expect(bar(page).getByRole('tab', { name: '开始', exact: true })).toBeVisible();
});

test('keeps file groups out of session history and removes a group after its last file closes', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.getByTestId('workspace-area-code').click();
  await bar(page).getByRole('button', { name: '新建文件', exact: true }).click();
  await expect(rows(page, 'code')).toHaveCount(1);
  await rows(page, 'code').first().click({ button: 'right' }); await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Files'); await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  const header = bar(page).getByRole('button', { name: 'Files', exact: true }); await expect(header).toBeVisible();
  await header.click({ button: 'right' });
  await expect(page.getByRole('button', { name: '归档分组', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await rows(page, 'code').first().getByRole('button', { name: /关闭文件/ }).click();
  await expect(header).toHaveCount(0);
  await page.getByTestId('workspace-history').click();
  await expect(page.getByTestId('unified-history-page')).toBeVisible();
  await expect(page.locator('.history-group-card').filter({ hasText: 'Files' })).toHaveCount(0);
  await expect(page.locator('.history-item').filter({ hasText: '未命名' })).toHaveCount(0);
});

test('merges and detaches terminal tabs without restarting live processes', async ({ page }) => {
  test.setTimeout(60_000); await setupTauriMock(page); await page.goto('/'); await createTwo(page, 'terminal');
  const first = rows(page, 'terminal').first(); const last = rows(page, 'terminal').last();
  const sourceTitle = await last.getByRole('tab').innerText();
  const source = await page.locator('.terminal-pane:visible').elementHandle();
  const spawns = await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length);
  await first.click({ button: 'right' }); await page.getByRole('menuitem', { name: '合并标签页到当前标签', exact: true }).hover();
  await page.getByRole('button', { name: sourceTitle, exact: true }).last().click();
  await pickPlacementZone(page, page.locator('.unified-pane:visible').first(), 'right');
  await expect(rows(page, 'terminal')).toHaveCount(1); await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
  expect(await source!.evaluate(element => element.isConnected)).toBe(true);
  await page.locator('.terminal-pane:visible').last().click({ button: 'right', position: { x: 80, y: 80 } });
  await page.getByRole('button', { name: '将窗格移至新标签页', exact: true }).click();
  await expect(rows(page, 'terminal')).toHaveCount(2);
  expect(await source!.evaluate(element => element.isConnected)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBe(spawns);
});
