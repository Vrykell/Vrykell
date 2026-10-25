import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

test('splits files inside the editor workspace and preserves independent buffers', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-code').click();
  await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
  const bar = page.getByTestId('workspace-instance-bar');
  await bar.getByRole('button', { name: '拆分标签页', exact: true }).click();
  const triggerBounds = await bar.getByRole('button', { name: '拆分标签页', exact: true }).boundingBox();
  const menuBounds = await page.getByRole('menu', { name: '选择分屏标签', exact: true }).boundingBox();
  expect(Math.abs(menuBounds!.y - triggerBounds!.y - triggerBounds!.height - 4)).toBeLessThan(2);
  await expect(page.locator('.workspace-layout')).toHaveAttribute('data-area', 'code');
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  const workspace = page.getByTestId('pane-workspace-code');
  await pickPlacementZone(page, workspace.locator('.unified-pane').first(), 'right');
  await expect(workspace.locator('.monaco-editor')).toHaveCount(2);
  await expect(bar.locator('.folder-header')).toHaveCount(1);
  await expect(page.locator('.workspace-layout')).toHaveAttribute('data-area', 'code');
  await page.getByTestId('workspace-area-unified').click();
  await page.getByTestId('workspace-area-code').click();
  await expect(workspace.locator('.monaco-editor')).toHaveCount(2);
  await workspace.locator('.monaco-editor').last().click({ button: 'right', position: { x: 80, y: 50 } });
  await page.getByRole('menu', { name: '窗格操作', exact: true }).getByRole('menuitem', { name: '移除此分屏', exact: true }).click();
  await expect(page.locator('.monaco-editor:visible')).toHaveCount(1);
});

test('opens an existing file as a split only after choosing its position', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-code').click();
  await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = ['/home/e2e/project/chosen.txt']; });
  await page.keyboard.press('Control+d');
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const workspace = page.getByTestId('pane-workspace-code');
  await expect(page.getByTestId('placement-overlay')).toBeVisible();
  await expect(workspace.locator('.monaco-editor')).toHaveCount(1);
  await pickPlacementZone(page, workspace.locator('.unified-pane').first(), 'right');
  await expect(workspace.locator('.monaco-editor')).toHaveCount(2);
  await expect(page.getByTestId('workspace-instance-bar')).toContainText('chosen.txt');
  await expect(page.locator('.workspace-layout')).toHaveAttribute('data-area', 'code');
});

test('selects an ACP working directory before opening its session', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await page.locator('[data-testid="acp-launcher-directory"]:visible').fill('C:/work/project');
  await page.locator('[data-testid="acp-launcher-Fake ACP"]:visible').click();
  await expect(page.locator('[data-testid="harness-page"]:visible [data-tip="C:/work/project"]')).toHaveCount(1);
  await expect(page.getByTestId('harness-directory')).toHaveCount(0);
});

test('keeps terminal splitting native and badges the original terminal icon', async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await expect(page.locator('.terminal-pane:visible')).toHaveCount(1);
  await page.keyboard.press('Control+d');
  await pickPlacementZone(page, page.locator('.terminal-pane:visible').first(), 'right');
  await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
  await expect(page.locator('.workspace-layout')).toHaveAttribute('data-area', 'terminal');
  const badge = page.getByTestId('workspace-instance-bar').locator('[data-icon-count="2"]');
  await expect(badge.locator('[data-shell-mark]')).toBeVisible();
  await expect(badge.locator('.icon-count-badge-dot')).toHaveText('2');
  expect(await badge.evaluate(element => getComputedStyle(element).overflow)).toBe('visible');
  await page.screenshot({ path: info.outputPath('native-terminal-count-badge.png') });
});

test('keeps split conversation tools in the existing tab strip, not extra pane headers', async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  const bar = page.getByTestId('workspace-instance-bar');
  await bar.getByRole('button', { name: '拆分标签页', exact: true }).click();
  await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
  const workspace = page.getByTestId('pane-workspace-ai');
  await pickPlacementZone(page, workspace.locator('.unified-pane').first(), 'right');
  await expect(workspace.locator('[data-chat-composer]')).toHaveCount(2);
  await expect(workspace.locator('.chat-conversation-heading')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '会话设置', exact: true })).toHaveCount(1);
  await workspace.locator('[data-chat-composer]').first().fill('First draft');
  await workspace.locator('[data-chat-composer]').last().fill('Second draft');
  await expect(bar.getByRole('button', { name: '会话设置', exact: true })).toHaveCount(1);
  await expect(workspace.locator('[data-chat-composer]').first()).toHaveValue('First draft');
  await page.screenshot({ path: info.outputPath('conversation-panes-one-toolbar.png') });
});
