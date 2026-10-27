import { test, expect } from '@playwright/test';
import { clipboardText, mockAnthropic, ptyWrites, setupTauriMock, terminalRowHeight } from './tauri-mock';

test.describe('命令块操作全链路', () => {
  test('commands and output keep their geometry while context remains visible and hover reveals only more', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await input.fill('echo content-first');
    await input.press('Enter');
    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo content-first' }).first();
    await expect(block).toBeVisible();
    await page.mouse.move(0, 0);
    const metadata = block.locator('.command-block-info');
    await expect(metadata).toHaveCSS('opacity', '1');
    await expect(block.locator('.command-block-cwd')).toBeVisible();
    await expect(block.locator('.command-status-duration')).toBeVisible();
    await expect(block.locator('.command-block-actions')).toHaveCSS('opacity', '0');
    const command = block.locator('.command-block-command');
    const output = block.locator('.command-block-output');
    const before = { command: await command.boundingBox(), output: await output.boundingBox() };
    const bounds = (await block.boundingBox())!;
    const background = await block.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(before.command!.x - bounds.x).toBe(16);
    expect(before.output!.x).toBe(before.command!.x);
    expect(before.output!.y - before.command!.y - before.command!.height).toBe(8);
    await block.hover();
    await expect(block.locator('.command-block-actions')).toHaveCSS('opacity', '1');
    await expect(block).toHaveCSS('background-color', background);
    expect(await command.boundingBox()).toEqual(before.command);
    expect(await output.boundingBox()).toEqual(before.output);
    await expect(block.getByRole('button')).toHaveCount(1);
    const more = block.getByRole('button', { name: '更多操作' });
    await expect(more).toHaveCSS('width', '28px');
    await expect(more.locator('svg')).toHaveCSS('width', '16px');
    await expect(page.getByRole('button', { name: /^(展开|折叠)(全部)?$/ })).toHaveCount(0);
    await block.screenshot({ path: test.info().outputPath('content-first-hover.png') });
    await page.mouse.move(0, 0);
    await expect(metadata).toHaveCSS('opacity', '1');
    await expect(block.locator('.command-block-cwd')).toBeVisible();
    await expect(block.locator('.command-status-duration')).toBeVisible();
    await expect(block.locator('.command-block-actions')).toHaveCSS('opacity', '0');
    await block.screenshot({ path: test.info().outputPath('content-first-rest.png') });
    await page.keyboard.press('Tab');
    await more.focus();
    await expect(block.locator('.command-block-actions')).toHaveCSS('opacity', '1');
    await more.press('Enter');
    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu.getByRole('menuitem', { name: '重新运行' })).toBeFocused();
    await expect(block).toHaveCSS('background-color', background);
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: '发给 AI 分析' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(output).toContainText('content-first');
  });

  test('命令块右键菜单出现在鼠标点击位置', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo context-menu-position');
    await input.press('Enter');

    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo context-menu-position' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });
    await block.evaluate((element) => {
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 180,
        clientY: 160,
      }));
    });

    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(180);
    expect(bounds!.y).toBe(160);
  });

  test('运行命令后复制命令和输出，并通过同一面板重新运行', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');

    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo linux-block-action');
    await input.press('Enter');

    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo linux-block-action' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });
    await expect(block).toContainText('linux-block-action');

    await block.hover();
    await block.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '复制命令' }).click();
    await expect.poll(() => clipboardText(page)).toBe('echo linux-block-action');
    await page.mouse.move(0, 0);
    await expect(block.locator('.command-block-actions')).toHaveCSS('opacity', '0');
    await expect(block.locator('.command-block-cwd')).toBeVisible();
    await expect(page.getByText('已复制', { exact: true })).toHaveCount(0);

    await block.hover();
    await block.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '复制输出' }).click();
    await expect.poll(() => clipboardText(page)).toBe('linux-block-action');

    const writesBefore = (await ptyWrites(page)).length;
    await block.hover();
    await block.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '重新运行' }).click();
    await expect.poll(async () => (await ptyWrites(page)).slice(writesBefore)).toContain('echo linux-block-action\n');
    await expect(block).toContainText('linux-block-action');
  });

  test('通过更多菜单复制输出并清除当前面板的命令块', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');

    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo menu-action');
    await input.press('Enter');
    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo menu-action' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });

    await block.hover();
    await block.getByRole('button', { name: '更多操作' }).click();
    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: '复制输出' }).click();
    await expect.poll(() => clipboardText(page)).toBe('menu-action');

    await block.hover();
    await block.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '清除所有块' }).click();
    await expect(block).toHaveCount(0);
  });
});

test('narrow panes preserve context above multiline commands and all output', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.setViewportSize({ width: 720, height: 800 });
  const input = page.getByPlaceholder(/输入命令/);
  const command = 'echo ' + 'long-path/'.repeat(35);
  await input.fill(command);
  await input.press('Enter');
  const block = page.locator('[data-testid^="command-block-"]').last();
  await expect(block).toContainText(command);
  await block.hover();
  const more = block.getByRole('button', { name: '更多操作' });
  await expect(more).toBeVisible();
  const geometry = await block.evaluate(element => {
    const cmd = element.querySelector<HTMLElement>('.command-block-command')!;
    const output = element.querySelector<HTMLElement>('.command-block-output')!;
    return { overflow: element.scrollWidth - element.clientWidth, aligned: cmd.offsetLeft === output.offsetLeft,
      rows: cmd.clientHeight / parseFloat(getComputedStyle(cmd).lineHeight) };
  });
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.aligned).toBe(true);
  expect(geometry.rows).toBeGreaterThan(1);
  await more.click();
  const menu = page.getByRole('menu', { name: '命令块操作' });
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(720);
  await page.keyboard.press('Escape');
});

test('long commands truncate in the action menu header instead of widening the menu', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  const command = `Get-Date; ${'"ISO: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"); '.repeat(4)}echo tail`;
  await input.fill(command);
  await input.press('Enter');
  const block = page.locator('[data-testid^="command-block-"]').last();
  await expect(block).toContainText('echo tail');
  await block.hover();
  await block.getByRole('button', { name: '更多操作' }).click();
  const menu = page.getByRole('menu', { name: '命令块操作' });
  const bounds = (await menu.boundingBox())!;
  // The summary line ellipsizes at a compact width; it never stretches the menu to the viewport.
  expect(bounds.width).toBeLessThanOrEqual(400);
  const code = await menu.locator('code').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(code.scroll).toBeGreaterThan(code.client);
});

test('the more menu stages a command snapshot for AI analysis while preserving terminal output', async ({ page }) => {
  await setupTauriMock(page);
  await mockAnthropic(page, 'Analysis complete.');
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('echo analyze-me');
  await input.press('Enter');
  const block = page.locator('[data-testid^="command-block-"]').last();
  await expect(block.locator('.command-block-output')).toContainText('analyze-me');
  await expect(block.getByTestId('exit-code')).toBeVisible();
  await block.hover();
  await block.getByRole('button', { name: '更多操作' }).hover();
  await block.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: '发给 AI 分析' }).click();
  await expect(page.locator('[data-chat-composer]:visible')).toHaveValue('帮我分析这条命令的执行结果。');
  await page.locator('[data-chat-composer]:visible').press('Enter');
  await expect(page.getByRole('menu', { name: '命令块操作' })).toHaveCount(0);
  await expect(page.locator('.ai-chat-panel')).toContainText('帮我分析这条命令的执行结果');
  await expect(page.getByText('Analysis complete.').first()).toBeVisible();
});

test('two-row command output matches the compact context and spacing proportions', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const target = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } };
    const original = target.__TAURI_INTERNALS__.invoke;
    target.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command === 'get_session_blocks' && args.sessionId === 't1') {
        return Promise.resolve([53, 44].map((duration, index) => ({
          id: `compact-${index}`, session_id: 't1', pane_id: null, command: 'ls', cwd: '~', status: 'done', exit_code: 0,
          started_at: 0, ended_at: duration, output_raw: '', output_html: '',
          output_clean: 'Desktop       Downloads     Movies        Pictures\nDocuments     Library       Music         Public',
        })));
      }
      return original(command, args);
    };
  });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.mouse.move(0, 0);
  const block = page.getByTestId('command-block-compact-0');
  await expect(block.locator('.command-block-cwd')).toHaveText('~');
  await expect(block.locator('.command-status-duration')).toHaveText('(0.053s)');
  const geometry = await block.evaluate(element => {
    const info = element.querySelector<HTMLElement>('.command-block-info')!;
    const command = element.querySelector<HTMLElement>('.command-block-command')!;
    const output = element.querySelector<HTMLElement>('.command-block-output')!;
    return { height: element.clientHeight, contextHeight: info.clientHeight,
      contextGap: command.getBoundingClientRect().top - info.getBoundingClientRect().bottom,
      outputHeight: output.clientHeight, font: parseFloat(getComputedStyle(command).fontSize) };
  });
  // Row height comes from the measured font metrics, so express the geometry in measured units:
  // one row each for vertical padding, metadata, and command; two output rows with half-row spacing.
  const rowHeight = await terminalRowHeight(page);
  expect(geometry.contextHeight).toBe(rowHeight);
  expect(geometry.contextGap).toBe(2);
  expect(geometry.outputHeight).toBe(rowHeight * 2);
  expect(geometry.height).toBe(rowHeight * 6.5 + 2);
  expect(geometry.height / rowHeight).toBeLessThan(7);
  await page.locator('[data-testid^="terminal-flow-"]').first().screenshot({ path: test.info().outputPath('compact-command-blocks.png') });
});
