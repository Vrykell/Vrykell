import { test, expect } from '@playwright/test';
import { clipboardText, mockAnthropic, ptyWrites, setupTauriMock } from './tauri-mock';

test.describe('命令块操作全链路', () => {
  test('commands and output keep their geometry while hover reveals context and only more', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await input.fill('echo content-first');
    await input.press('Enter');
    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo content-first' }).first();
    await expect(block).toBeVisible();
    await page.mouse.move(0, 0);
    const metadata = block.locator('.command-block-info');
    await expect(metadata).toHaveCSS('opacity', '0');
    const command = block.locator('.command-block-command');
    const output = block.locator('.command-block-output');
    const before = { command: await command.boundingBox(), output: await output.boundingBox() };
    const bounds = (await block.boundingBox())!;
    expect(before.command!.x - bounds.x).toBe(32);
    expect(before.output!.x).toBe(before.command!.x);
    expect(before.output!.y - before.command!.y - before.command!.height).toBe(12);
    await block.hover();
    await expect(metadata).toHaveCSS('opacity', '1');
    expect(await command.boundingBox()).toEqual(before.command);
    expect(await output.boundingBox()).toEqual(before.output);
    await expect(block.getByRole('button')).toHaveCount(1);
    const more = block.getByRole('button', { name: '更多操作' });
    await expect(more).toHaveCSS('width', '28px');
    await expect(more.locator('svg')).toHaveCSS('width', '16px');
    await expect(page.getByRole('button', { name: /^(展开|折叠)(全部)?$/ })).toHaveCount(0);
    await block.screenshot({ path: test.info().outputPath('content-first-hover.png') });
    await page.mouse.move(0, 0);
    await expect(metadata).toHaveCSS('opacity', '0');
    await block.screenshot({ path: test.info().outputPath('content-first-rest.png') });
    await page.keyboard.press('Tab');
    await more.focus();
    await expect(metadata).toHaveCSS('opacity', '1');
    await more.press('Enter');
    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu.getByRole('menuitem', { name: '重新运行' })).toBeFocused();
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
    await expect(block.locator('.command-block-info')).toHaveCSS('opacity', '0');
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
    await page.locator('[data-tip="更多操作"]').click();
    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: '复制输出' }).click();
    await expect.poll(() => clipboardText(page)).toBe('menu-action');

    await block.hover();
    await page.locator('[data-tip="更多操作"]').click();
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

test('the more menu sends command output for AI analysis in the same pane', async ({ page }) => {
  await setupTauriMock(page);
  await mockAnthropic(page, 'Analysis complete.');
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('echo analyze-me');
  await input.press('Enter');
  const block = page.locator('[data-testid^="command-block-"]').last();
  await block.hover();
  await block.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: '发给 AI 分析' }).click();
  await expect(page.getByRole('menu', { name: '命令块操作' })).toHaveCount(0);
  await expect(page.locator('[data-testid^="terminal-flow-"]').first()).toContainText('分析这条命令的执行结果');
  await expect(page.getByText('Analysis complete.').first()).toBeVisible();
});
