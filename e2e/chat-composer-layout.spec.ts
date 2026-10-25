import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, ensureChatSettingsOpen } from './tauri-mock';
import { gotoSetting } from './settings';

async function resizeChat(page: Page, width: number) {
  const panel = await page.locator('.workspace-side-panel[data-side="right"]').boundingBox();
  const handle = (await page.getByTestId('resize-handle-chat').boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + panel!.width - width, y, { steps: 10 });
  await page.mouse.up();
}

test('model focus background leaves space around its name and arrow', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await resizeChat(page, 480);
  const lead = (await page.locator('.chat-composer-lead:visible').boundingBox())!;
  const add = (await page.getByRole('button', { name: '添加附件', exact: true }).boundingBox())!;
  expect(Math.abs(lead.x + lead.width / 2 - add.x - add.width / 2)).toBeLessThan(1);
  const button = page.getByTestId('pill-name');
  await page.keyboard.press('Tab');
  await button.focus();
  const spacing = await button.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const label = element.querySelector('span')!.getBoundingClientRect();
    const arrow = element.querySelector('svg:last-child')!.getBoundingClientRect();
    return { left: label.left - bounds.left, right: bounds.right - arrow.right };
  });
  expect(spacing.left).toBeGreaterThanOrEqual(10);
  expect(spacing.right).toBeGreaterThanOrEqual(10);
  await expect(page.getByTestId('model-pill')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.locator('.chat-composer').screenshot({ path: '.cache/chat-model-focus.png' });
});

test('model shape, approval hover and attachment chip hover share one visual language', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await resizeChat(page, 480);
  const status = page.locator('.chat-input-status');

  // The model control uses the permission button's rounded-square shape, not a pill.
  await expect(status.getByTestId('model-pill')).toHaveCSS('border-radius', '8px');
  await expect(status.getByTestId('chat-approval-select')).toHaveCSS('border-radius', '8px');

  // The approval menu keeps a single fill: hovering another row overrides the selection.
  await status.getByTestId('chat-approval-select').click();
  const selected = page.locator('.chat-mode-option[aria-selected="true"]');
  const other = page.locator('.chat-mode-option[aria-selected="false"]').first();
  await expect(selected).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await other.hover();
  await expect(other).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(selected).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Escape');

  // The attachment chip highlights as a whole instead of a small inner label background.
  const composer = page.locator('[data-chat-composer]');
  await composer.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File(['image'], 'screenshot.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  const chip = page.locator('.chat-attachment-chip').first();
  await expect(chip).toBeVisible();
  const resting = await chip.evaluate(element => getComputedStyle(element).backgroundColor);
  await chip.hover();
  const hovered = await chip.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(hovered).not.toBe(resting);
  await expect(chip.locator('.chat-attachment-name')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('long terminal names and directories fit at the minimum width with larger UI text', async ({ page }) => {
  await setupTauriMock(page, { launchDirectory: '/home/e2e/projects/very-long-directory-name' });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.setState(state => ({
      tabs: state.tabs.map(tab => tab.kind === 'session' && tab.layout.type === 'leaf' ? {
        ...tab, layout: { ...tab.layout, terminal: { ...tab.layout.terminal, shellType: 'powershell' } },
      } : tab),
      terminalCwds: { ...state.terminalCwds, ...Object.fromEntries(state.tabs.flatMap(tab =>
        tab.kind === 'session' && tab.layout.type === 'leaf' ? [[tab.layout.terminal.id, '/home/e2e/projects/very-long-directory-name']] : [])) },
    }));
  });
  await page.locator('[data-dock-btn="chat"]').click();
  await resizeChat(page, 1100);
  const status = page.locator('.terminal-input-status');
  await expect(status).toContainText('Windows PowerShell');
  for (const scale of [1, 1.25, 1.5]) {
    await page.evaluate(value => document.documentElement.style.setProperty('--ui-font-scale', String(value)), scale);
    expect(await status.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = (await status.boundingBox())!;
    for (const name of ['询问 AI', '选择类型分裂', '关闭当前终端']) {
      const control = status.getByRole('button', { name, exact: true });
      await expect(control).toBeInViewport();
      const rect = (await control.boundingBox())!;
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }
  }
  await page.locator('.workspace-body').screenshot({ path: '.cache/terminal-min-width.png' });
  await page.setViewportSize({ width: 720, height: 800 });
  expect(await status.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  for (const name of ['询问 AI', '选择类型分裂', '关闭当前终端']) {
    const control = status.getByRole('button', { name, exact: true });
    await expect(control).toBeInViewport({ ratio: 1 });
    const rect = (await control.boundingBox())!;
    expect(rect.x + rect.width).toBeLessThanOrEqual(720);
  }
  await page.locator('.workspace-body').screenshot({ path: '.cache/terminal-min-window.png' });
});

test('AI composer uses the original terminal composer height with a small blue send button', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  const terminal = page.locator('main .terminal-composer').first();
  const terminalHeight = (await terminal.boundingBox())!.height;
  await page.locator('[data-dock-btn="chat"]').click();
  await resizeChat(page, 480);
  const chat = page.locator('.chat-composer');
  await expect.poll(async () => (await chat.boundingBox())!.height).toBe(terminalHeight);
  expect((await terminal.boundingBox())!.height).toBe(terminalHeight);
  await expect(page.getByTestId('chat-context-usage')).toHaveCount(0);
  const send = page.getByRole('button', { name: '发送', exact: true });
  await page.locator('[data-chat-composer]').fill('Review this');
  expect((await send.boundingBox())!.height).toBe((await page.getByRole('button', { name: '添加附件', exact: true }).boundingBox())!.height);
  const blue = await send.evaluate(element => getComputedStyle(element).getPropertyValue('--primary-action').trim());
  await expect(send).toHaveCSS('background-color', blue.startsWith('#')
    ? `rgb(${[1, 3, 5].map(index => parseInt(blue.slice(index, index + 2), 16)).join(', ')})` : blue);
  await page.locator('.workspace-body').screenshot({ path: '.cache/composer-matched-heights.png' });
});

test('footer matches attachment, approval, model and send order without wrapping at narrow and wide sizes', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]');
  await composer.fill('Explain this screenshot');
  await composer.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File(['image'], 'screenshot.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.chat-context-tray')).toContainText('screenshot.png');
  await composer.evaluate(element => {
    const clipboard = new DataTransfer(); clipboard.setData('text/plain', 'File context\n'.repeat(60));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.chat-context-tray .chat-attachment-chip')).toHaveCount(2);
  const heading = page.locator('.chat-conversation-heading');
  await expect(heading.getByTestId('model-pill')).toHaveCount(0);
  await expect(heading.getByRole('button', { name: '对话与审批模式' })).toHaveCount(0);
  for (const width of [480, 320, 180]) {
    await resizeChat(page, width);
    const inputBox = (await composer.boundingBox())!;
    const tray = (await page.locator('.chat-context-tray').boundingBox())!;
    expect(tray.y + tray.height).toBeLessThanOrEqual(inputBox.y);
    const panel = (await page.locator('.ai-chat-panel').boundingBox())!;
    await expect(page.locator('.chat-input-status button')).toHaveCount(4);
    for (const control of [page.getByRole('button', { name: '会话设置', exact: true }),
      page.getByRole('button', { name: '发送', exact: true }), page.getByRole('button', { name: '添加附件', exact: true }),
      page.getByTestId('pill-name'), page.getByTestId('chat-approval-select')]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      const rect = (await control.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(panel.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    }
    await ensureChatSettingsOpen(page);
    const settings = page.getByRole('region', { name: '会话设置' });
    await expect(settings.getByTestId('model-pill')).toHaveCount(0);
    await expect(page.locator('.chat-input-status').getByTestId('model-pill')).toBeVisible();
    const approvalBounds = (await page.getByTestId('chat-approval-select').boundingBox())!;
    const modelBounds = (await page.getByTestId('model-pill').boundingBox())!;
    expect(approvalBounds.x + approvalBounds.width).toBeLessThanOrEqual(modelBounds.x);
    await page.getByRole('button', { name: '对话与审批模式' }).click();
    const approvalMenu = page.getByRole('listbox', { name: '对话与审批模式' });
    await expect(approvalMenu.getByText('如何审批 AI 操作？', { exact: true })).toHaveCount(0);
    expect((await approvalMenu.boundingBox())!.width).toBeLessThanOrEqual(248);
    if (width === 480) await page.getByRole('listbox', { name: '对话与审批模式' }).screenshot({ path: '.cache/chat-approval-menu.png' });
    await expect(page.getByRole('option', { name: /^纯聊天/ })).toBeInViewport();
    await page.getByRole('option', { name: /^纯聊天/ }).click();
    await ensureChatSettingsOpen(page);
    await page.getByRole('combobox', { name: '选择执行终端' }).scrollIntoViewIfNeeded();
    await page.getByRole('combobox', { name: '选择执行终端' }).click();
    await page.getByRole('option').filter({ hasNotText: '仅讨论' }).first().click();
    expect(await settings.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await settings.screenshot({ path: `.cache/chat-settings-${width}.png` });
    await page.getByRole('button', { name: '会话设置', exact: true }).click();
    await expect(settings).toBeHidden();
    await expect(page.locator('.chat-context-chip')).toHaveCount(0);
    await expect(composer).toHaveValue('Explain this screenshot');
    expect(await page.locator('.chat-input-status').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const centers = await page.locator('.chat-input-status').evaluate(element => Array.from(element.children).map(child => child.getBoundingClientRect()).filter(rect => rect.height > 0).map(rect => rect.y + rect.height / 2));
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
    await page.locator('.chat-input-status').evaluate(element => { element.scrollLeft = 0; });
    await page.locator('.workspace-body').screenshot({ path: `.cache/chat-composer-${width}.png` });
    await page.locator('.chat-composer').screenshot({ path: `.cache/chat-composer-refined-${width}.png` });
  }
});

test('sidebar resize leaves enough width for the terminal controls', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await resizeChat(page, 1100);
  expect((await page.locator('main').boundingBox())!.width).toBeGreaterThanOrEqual(360);
  await expect(page.getByRole('button', { name: '询问 AI', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 720, height: 800 });
  expect((await page.locator('main').boundingBox())!.width).toBeGreaterThanOrEqual(360);
});

for (const theme of ['深色', '浅色'] as const) {
  test(`composer preserves the spacious reference layout in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.addInitScript(() => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const invoke = bridge.invoke;
      bridge.invoke = async (command, args) => {
        const result = await invoke(command, args);
        if (command !== 'list_sessions' && command !== 'get_session') return result;
        const remoteSession = (session: Record<string, unknown>) => session.id !== 't1' ? session : {
          ...session, title: 'Server', payload: JSON.stringify({ layout: { type: 'leaf', terminal: {
            id: 't1#0', kind: 'ssh', openMode: 'block', ssh: { name: 'Server', host: '10.21.76.61', user: 'test', port: 22 },
          } } }),
        };
        return command === 'list_sessions' ? (result as Record<string, unknown>[]).map(remoteSession)
          : result ? remoteSession(result as Record<string, unknown>) : result;
      };
    });
    await page.goto('/');
    if (theme === '浅色') {
      await gotoSetting(page, '主题');
      await page.getByRole('radio', { name: theme, exact: true }).click();
    }
    await page.locator('[data-dock-btn="chat"]').click();
    await resizeChat(page, 480);
    await ensureChatSettingsOpen(page);
    const target = page.getByRole('combobox', { name: '选择执行终端' });
    await target.click();
    await page.getByRole('option', { name: 'Server', exact: true }).click();
    await expect(target).toHaveText('10.21.76.61');
    await page.getByRole('button', { name: '对话与审批模式' }).click();
    await page.getByRole('option', { name: /^严格权限/ }).click();
    await ensureChatSettingsOpen(page);
    await page.getByRole('region', { name: '会话设置' }).screenshot({ path: `.cache/chat-settings-${theme === '深色' ? 'dark' : 'light'}.png` });
    await page.getByRole('button', { name: '会话设置', exact: true }).click();
    await page.locator('[data-chat-composer]').click();
    await page.mouse.move(0, 0);
    const composer = page.locator('.chat-composer');
    const input = (await page.locator('.chat-composer-input').boundingBox())!;
    expect(input.height).toBeGreaterThanOrEqual(32);
    await expect(page.getByTestId('chat-conversation-context')).toHaveCount(0);
    await expect(page.locator('.chat-input-status button')).toHaveCount(4);
    expect(await page.locator('.chat-input-status').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await composer.screenshot({ path: `.cache/chat-composer-reference-${theme === '深色' ? 'dark' : 'light'}.png` });
    await page.locator('.ai-chat-panel').screenshot({ path: `.cache/chat-panel-simple-${theme === '深色' ? 'dark' : 'light'}.png` });
  });
}
