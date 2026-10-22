import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, ptyWrites, emitPtyOutput, ensureTabsOpen } from './tauri-mock';
import { gotoSetting } from './settings';

/** Resolve a theme custom property to the rgb()/rgba() form that toHaveCSS compares against. */
async function resolvedColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('global search stays centered without covering actions or the title in both page types', async ({ page }) => {
  for (const width of [600, 720, 900, 1240, 1550]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => {
      const search = (await page.getByTestId('global-search-trigger').boundingBox())!;
      const bar = (await page.locator('.workspace-titlebar').boundingBox())!;
      return Math.abs(search.x + search.width / 2 - bar.x - bar.width / 2);
    }).toBeLessThan(1);
    const search = await page.getByTestId('global-search-trigger').boundingBox();
    const actions = await page.locator('.workspace-title-actions').boundingBox();
    const title = await page.locator('.workspace-title').boundingBox();
    const bar = (await page.locator('.workspace-titlebar').boundingBox())!;
    expect(Math.abs(search!.x + search!.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(1);
    expect(search!.x).toBeGreaterThanOrEqual(title!.x + title!.width);
    expect(search!.x + search!.width).toBeLessThanOrEqual(actions!.x);
    if (await page.evaluate(() => /Mac/.test(navigator.userAgent))) {
      await expect(page.getByTestId('window-controls')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('window-close')).toBeInViewport();
    }
  }
  await page.keyboard.press('Control+,');
  const search = await page.getByTestId('global-search-trigger').boundingBox();
  const bar = (await page.locator('.workspace-titlebar').boundingBox())!;
  expect(Math.abs(search!.x + search!.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(1);
});

test('Windows working directories show their drive prefix without the URI slash', async ({ page }) => {
  await emitPtyOutput(page, '\x1b]7;file://host/C:/Users/My Project\x07');
  const directory = page.getByRole('button', { name: '切换工作目录' });
  await expect(directory).toHaveText('C:/Users/My Project');
  await expect(directory).toHaveAttribute('data-tip', 'C:/Users/My Project');
});

test('terminal error notifications follow the active gray theme and can be closed', async ({ page }) => {
  await page.evaluate(() => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = (command, args) => command === 'plugin:clipboard-manager|write_text'
      ? Promise.reject(new Error('clipboard unavailable')) : invoke(command, args);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => Promise.reject(new Error('clipboard unavailable')) },
    });
    document.execCommand = () => false;
  });
  for (const theme of ['深色', '浅色']) {
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.keyboard.press('Meta+1');
    const input = page.getByPlaceholder(/输入命令/);
    const command = `echo notification-${theme === '浅色' ? 'light' : 'dark'}`;
    await input.fill(command);
    await input.press('Enter');
    const block = page.locator('[data-testid^="command-block-"]').filter({
      has: page.locator('.command-block-command', { hasText: command }),
    });
    await expect(block.locator('.command-block-output')).toBeVisible();
    await block.hover();
    await expect(block.locator('.command-block-info')).toHaveCSS('opacity', '1');
    await block.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '复制输出' }).click();
    const notification = page.getByRole('status').filter({ hasText: '复制失败' });
    await expect(notification).toBeVisible();
    await notification.hover();
    await expect(notification).toHaveCSS('background-color', await resolvedColor(page, '--menu-bg'));
    await expect(notification).toHaveCSS('border-radius', '10px');
    // Floating surfaces separate with an outer shadow instead of a border.
    await expect(notification).toHaveCSS('border-width', '0px');
    await page.screenshot({ path: `ux-audit.local/after-notification-${theme}.png` });
    await notification.getByRole('button', { name: '关闭通知' }).click();
    await expect(notification).toBeHidden();
  }
});

test('navigation supports Enter and Space and shows its active state', async ({ page }) => {
  const terminal = page.getByTestId('workspace-area-terminal');
  const code = page.getByTestId('workspace-area-code');
  await expect(terminal).toHaveAttribute('aria-current', 'page');
  await code.focus(); await code.press('Enter');
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await expect(code).toHaveAttribute('aria-current', 'page');
  await terminal.focus(); await terminal.press('Space');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await expect(terminal).toHaveAttribute('aria-current', 'page');
});

test('navigation switches panels without losing their local state', async ({ page }) => {
  await ensureTabsOpen(page);
  await page.getByTestId('tab-search').fill('测试筛选');
  await page.locator('[data-dock-btn="ssh"]').click();
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await expect(page.getByTestId('tab-search')).toBeHidden();
  await page.locator('[data-dock-btn="tabs"]').click();
  await expect(page.getByTestId('tab-search')).toHaveValue('测试筛选');
  await expect(page.getByTestId('ssh-search')).toBeHidden();
});

test('the full-height navigation and titlebar separate workspace and auxiliary content', async ({ page }) => {
  await page.locator('[data-dock-btn="files"]').click();
  const nav = page.getByTestId('workspace-sidebar');
  const panel = page.locator('.workspace-side-panel[data-side="right"]:visible');
  expect(await nav.boundingBox()).toMatchObject({ x: 0, y: 0, width: 208, height: 800 });
  expect((await panel.boundingBox())!.width).toBe(200);
  const active = nav.locator('[aria-current="page"]');
  expect(await active.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
  await expect(active).toHaveCSS('border-top-style', 'none');
  await expect(page.locator('.workspace-titlebar')).toHaveCSS('border-bottom-style', 'none');
  await expect(panel.locator('.workspace-panel-heading')).toHaveCSS('border-bottom-style', 'none');
  await expect(panel).toHaveCSS('border-left-style', 'none');
  const panelBg = await panel.locator(':scope > div').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(panelBg).not.toBe(await nav.evaluate(el => getComputedStyle(el).backgroundColor));
  expect(panelBg).toBe(await resolvedColor(page, '--auxiliary-bg'));
  const contentBg = await page.locator('main').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(panelBg).not.toBe(contentBg);
  expect(contentBg).not.toBe(await nav.evaluate(el => getComputedStyle(el).backgroundColor));
  const mainRect = await page.locator('main').boundingBox();
  expect(mainRect!.y).toBeGreaterThan(0);
  expect(mainRect!.y + mainRect!.height).toBe(800);
  for (const id of ['files', 'git', 'command-history']) {
    if (await page.locator(`[data-dock-btn="${id}"]`).getAttribute('aria-pressed') === 'true') await page.locator(`[data-dock-btn="${id}"]`).click();
    await page.locator(`[data-dock-btn="${id}"]`).click();
    await expect(page.locator('.workspace-side-panel[data-side="right"]:visible > div:first-child')).toHaveCSS('background-color', panelBg);
  }
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('.workspace-side-panel[data-side="right"]:visible > div:first-child')).toHaveCSS('background-color', panelBg);
  await expect(page.locator('.workspace-side-panel[data-side="right"] .terminal-composer')).toHaveCSS('background-color', await resolvedColor(page, '--composer-bg'));
});

test('workspace regions have square corners and flush resize boundaries', async ({ page }) => {
  const main = page.locator('main');
  await expect(main).toHaveCSS('border-radius', '0px');
  expect((await main.boundingBox())!.x).toBe(208);

  await page.locator('[data-dock-btn="chat"]').click();
  const rightPanel = page.locator('.workspace-side-panel[data-side="right"]:visible');
  await expect(rightPanel).toHaveCount(1);
  await expect(rightPanel).toHaveCSS('border-radius', '0px');
  await expect(rightPanel).toHaveCSS('margin-left', '0px');
  // The shared edge squares off and the divider stays on the actual color boundary.
  await expect(main).toHaveCSS('border-top-right-radius', '0px');
  await expect(main).toHaveCSS('border-bottom-right-radius', '0px');
  const mainBox = (await main.boundingBox())!;
  const panelBox = (await rightPanel.boundingBox())!;
  expect(Math.abs(panelBox.x - (mainBox.x + mainBox.width))).toBeLessThan(0.5);
  const line = page.getByTestId('resize-handle-chat').locator('[data-resize-line]');
  await expect(line).toHaveCSS('width', '1px');
  await expect(line).toHaveCSS('background-color', await resolvedColor(page, '--resize-divider'));
  const lineBox = (await line.boundingBox())!;
  expect(Math.abs(lineBox.x + lineBox.width / 2 - (mainBox.x + mainBox.width))).toBeLessThan(0.5);
  await expect(main).toHaveCSS('border-top-left-radius', '0px');
  await expect(main).toHaveCSS('border-bottom-left-radius', '0px');
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(main).toHaveCSS('border-radius', '0px');
});

test('settings use the auxiliary background and remain distinct from terminal content', async ({ page }) => {
  await page.locator('[data-dock-btn="files"]').click();
  const background = async (selector: string) => page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor);
  const terminalBg = await resolvedColor(page, '--xterm-bg');
  const auxiliaryBg = await resolvedColor(page, '--auxiliary-bg');
  await gotoSetting(page, '模型配置');
  await expect(page.getByTestId('provider-switch')).toBeVisible();
  expect(await background('.settings-content')).toBe(await resolvedColor(page, '--canvas'));
  expect(await background('.settings-navigation')).not.toBe(terminalBg);
  await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
  for (const label of ['浅色', '深色']) {
    await page.getByRole('radio', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', label === '浅色' ? 'light' : 'dark');
    expect(await background('.workspace-titlebar')).not.toBe(await background('main'));
    const sidebarBg = await background('.workspace-side-panel[data-side="right"] > div:first-child');
    expect(sidebarBg).not.toBe(await background('.workspace-sidebar'));
    expect(sidebarBg).not.toBe(await background('main'));
    expect(await background('.settings-navigation')).toBe(sidebarBg);
    expect(await background('.settings-content')).toBe(await resolvedColor(page, '--canvas'));
    const aliases = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return ['--text-title', '--text-primary', '--tab-hover', '--hover'].map(key => css.getPropertyValue(key).trim());
    });
    expect(aliases[0]).toBe(aliases[1]);
    expect(aliases[2]).toBe(aliases[3]);
  }
});

test('settings keep the auxiliary background while editor, diffs and history use content surfaces', async ({ page }) => {
  const background = async (selector: string) => page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor);
  const terminalBg = await resolvedColor(page, '--xterm-bg');
  const auxiliaryBg = await resolvedColor(page, '--auxiliary-bg');
  const canvasBg = await resolvedColor(page, '--canvas');
  expect(terminalBg).toBe('rgb(20, 20, 20)');

  await gotoSetting(page, '主题');
  for (const selector of ['.settings-screen', '.settings-view']) {
    expect(await background(selector), selector).toBe(auxiliaryBg);
  }
  expect(await background('.settings-content'), '.settings-content').toBe(await resolvedColor(page, '--canvas'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('.settings-screen')).toHaveCount(0);

  await page.getByRole('button', { name: '版本控制', exact: true }).click();
  const panel = page.getByTestId('git-panel');
  await panel.getByTestId('git-unstaged-src/main.ts').click();
  const review = page.getByTestId('git-diff-review');
  await expect(review.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });
  for (const selector of ['.git-review', '.git-review .code-diff-frame', '.git-review .monaco-editor-background']) {
    expect(await background(selector), selector).toBe(terminalBg);
  }

  const row = panel.getByTestId('git-unstaged-src/main.ts');
  await row.hover();
  await row.getByRole('button', { name: '打开工作文件' }).click();
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
  for (const selector of ['.editor-pane', '.code-editor-frame', '.folder-path', '.code-editor .monaco-editor-background']) {
    expect(await background(selector), selector).toBe(terminalBg);
  }

  await ensureTabsOpen(page);
  await page.getByTestId('tab-history-btn').click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
  expect(await background('.history-page')).toBe(canvasBg);

  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
  expect(await background('.history-page')).toBe(canvasBg);
});

test('auxiliary resize edges remain visible and strengthen during drag', async ({ page }) => {
  for (const id of ['files', 'chat']) {
    await page.locator(`[data-dock-btn="${id}"]`).click();
    const handle = page.getByTestId(`resize-handle-${id}`);
    const line = handle.locator('[data-resize-line]');
    const activeColor = await resolvedColor(page, '--border-strong');
    await expect(line).toHaveCSS('background-color', await resolvedColor(page, '--resize-divider'));
    await expect(handle).toHaveCSS('cursor', 'col-resize');
    expect((await handle.boundingBox())!.width).toBeGreaterThanOrEqual(8);
    const panel = handle.locator('..');
    const before = (await panel.boundingBox())!.width;
    const rect = (await handle.boundingBox())!;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await page.mouse.move(x, y);
    await expect(line).toHaveCSS('background-color', activeColor);
    await page.mouse.down();
    await page.mouse.move(x - 40, y);
    await page.mouse.move(x - 40, y + 80);
    await expect(line).toHaveCSS('background-color', activeColor);
    expect((await panel.boundingBox())!.width).toBe(before + 40);
    await page.mouse.up();
    await page.mouse.move(700, 700);
    await expect(line).toHaveCSS('background-color', await resolvedColor(page, '--resize-divider'));
  }
});

test('narrow layouts preserve command space and fit the toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('workspace-sidebar-expand').click();
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('workspace-sidebar-toggle').click();
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await expect(page.getByText('notes.txt')).toBeVisible();
  const main = await page.locator('main').boundingBox();
  expect(main!.width).toBeGreaterThanOrEqual(360);
  await expect(page.getByTestId('workspace-sidebar-expand')).toBeInViewport();
  const overlap = await page.evaluate(() => {
    const search = document.querySelector('[data-testid="global-search-trigger"]')!.getBoundingClientRect();
    const ai = document.querySelector('.workspace-title-actions')!.getBoundingClientRect();
    return search.right > ai.left;
  });
  expect(overlap).toBe(false);
});

test('AI drafts stay separate when opening the AI assistant', async ({ page }) => {
  await page.getByRole('button', { name: '询问 AI', exact: true }).click();
  await page.getByPlaceholder(/自然语言描述/).fill('帮我解释这个项目');
  await page.locator('[data-dock-btn="chat"]').click();
  const command = page.getByPlaceholder(/输入命令/);
  await expect(command).toHaveValue('');
  await command.press('Enter');
  expect(await ptyWrites(page)).not.toContain('帮我解释这个项目\n');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: '询问 AI', exact: true }).click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toHaveValue('帮我解释这个项目');
});

test('separate command and AI drafts survive repeated switches', async ({ page }) => {
  await page.getByPlaceholder(/输入命令/).fill('git status');
  await page.getByRole('button', { name: '询问 AI', exact: true }).click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toHaveValue('');
  await page.getByPlaceholder(/自然语言描述/).fill('解释当前修改');
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.getByPlaceholder(/输入命令/)).toHaveValue('git status');
});

test('split placement previews the hovered slot and closes with Escape', async ({ page }) => {
  await page.locator('[data-tip="选择类型分裂"]').click();
  await page.getByTestId('new-tab-option-shell:zsh').click();
  const overlay = page.getByTestId('placement-overlay');
  await expect(overlay).toBeVisible();
  // 覆盖层不显示提示文案：悬停前为空，悬停后只出现指针下的灰色预览
  await expect(overlay).toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('split placement closes when it loses focus', async ({ page }) => {
  // 点击覆盖层之外的侧栏按钮 → 自动取消
  await page.keyboard.press('Meta+d');
  await expect(page.getByTestId('placement-overlay')).toBeVisible();
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByTestId('placement-overlay')).toHaveCount(0);

  // 窗口失焦 → 自动取消
  await page.keyboard.press('Meta+d');
  await expect(page.getByTestId('placement-overlay')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('placement-overlay')).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('auxiliary navigation shares the right side and AI preserves the main workspace', async ({ page }) => {
  await expect(page.locator('[data-dock-btn="chat"]')).toHaveAttribute('data-tip', /打开AI/);
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('notes.txt')).toBeVisible();
  await expect(page.getByTestId('tab-search')).toBeHidden();
  await expect(page.locator('.workspace-side-panel[data-side="left"]:visible')).toHaveCount(0);
  await expect(page.locator('.workspace-side-panel[data-side="right"]:visible')).toHaveCount(1);
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('.workspace-side-panel[data-side="right"]:visible')).toHaveCount(1);
  await expect(page.getByText('notes.txt')).toBeHidden();
  await page.locator('[data-dock-btn="tabs"]').click();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
  await expect(page.getByTestId('workspace-settings')).toHaveAttribute('data-dock-fixed', 'true');
  await expect(page.locator('header').getByRole('button', { name: '设置', exact: true })).toHaveCount(0);
});

test('panel headings close auxiliary content without hiding the workspace', async ({ page }) => {
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: '关闭AI 助手面板', exact: true }).click();
  await expect(page.locator('[data-chat-composer]')).toBeHidden();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByRole('button', { name: '关闭资源面板', exact: true }).click();
  await expect(page.getByTestId('workspace-instance-bar')).toBeVisible();
});

test('dragging a navigation action preserves panel placement and order', async ({ page }) => {
  const source = (await page.locator('[data-dock-btn="files"]').boundingBox())!;
  const target = (await page.locator('[data-dock-btn="git"]').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width - 2, target.y + target.height / 2, { steps: 8 }); await page.mouse.up();
  const ids = await page.getByRole('navigation', { name: '辅助面板' }).locator('[data-dock-btn]').evaluateAll(elements => elements.map(el => el.getAttribute('data-dock-btn')));
  expect(ids).toEqual(['git', 'files', 'command-history', 'chat']);
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('notes.txt')).toBeVisible();
  await expect(page.getByTestId('tab-search')).toBeHidden();
  await expect(page.locator('.workspace-side-panel[data-side="right"]:visible')).toHaveCount(1);
});
