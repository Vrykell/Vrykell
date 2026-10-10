import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock, ptyWrites, emitPtyOutput } from './tauri-mock';

async function ready(page: Page) {
  await setupTauriMock(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15' }));
  await page.goto('/');
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    const scope = window as unknown as { __vrykellSessionRegistry?: { controllers: Map<string, import('../src/features/terminal/services/pipeline/sessionController').SessionController> } };
    return Object.values(useTerminalStore.getState().startupStates).includes('ready')
      && [...(scope.__vrykellSessionRegistry?.controllers.values() ?? [])].some(controller => controller.activeBlock?.status === 'pending' && !!controller.activeBlock.cwd);
  });
}

test('empty and repeat Enter submissions keep normal directory blocks with no output', async ({ page }) => {
  await ready(page);
  const input = page.getByPlaceholder(/输入命令/);
  await input.focus();
  for (let index = 0; index < 6; index++) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  const blocks = page.locator('.command-block');
  await expect(blocks).toHaveCount(6);
  await expect.poll(async () => (await ptyWrites(page)).filter(write => write === '\n').length).toBe(6);
  for (const block of await blocks.all()) {
    await expect(block.locator('.command-block-cwd')).toHaveText('/home/e2e/project');
    await expect(block.locator('.command-block-command')).toBeEmpty();
    await expect(block.locator('.command-block-output')).toHaveCount(0);
  }
  await input.fill('\n\n');
  await input.press('Enter');
  await expect(blocks).toHaveCount(9);
  expect((await ptyWrites(page)).at(-1)).toBe('\n\n\n');
});

test('cwd menu searches folders, changes directories, and preserves the command draft', async ({ page }) => {
  await ready(page);
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('echo preserved');
  const trigger = page.getByRole('button', { name: '切换工作目录' });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const menu = page.getByRole('dialog', { name: '选择工作目录' });
  await expect(menu.getByRole('option', { name: /上级目录/ })).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Documents' })).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Documents' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(menu.getByRole('option', { name: 'Documents' })).toHaveCSS('border-radius', '0px');
  await expect(menu.getByRole('option', { name: 'notes.txt' })).toHaveCount(0);
  const search = menu.getByRole('combobox');
  await search.fill('download');
  await expect(menu.getByRole('option', { name: 'Downloads' })).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Documents' })).toHaveCount(0);
  await search.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await ptyWrites(page)).at(-1)).toBe("cd -- '/home/e2e/Downloads'\n");
  await expect(input).toHaveValue('echo preserved');
  await expect(input).toBeFocused();
  await trigger.click();
  await menu.getByRole('combobox').press('Escape');
  await expect(menu).toHaveCount(0);
});

test('command and AI mode icons share their size and the outer border follows window corners', async ({ page }) => {
  await ready(page);
  const toggle = page.getByRole('button', { name: /切换到.*模式|切回命令模式/ });
  await expect(toggle.locator('svg')).toHaveCSS('width', '18px');
  const commandBounds = (await toggle.boundingBox())!;
  await toggle.click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
  await expect(toggle.locator('svg')).toHaveCSS('width', '18px');
  const aiBounds = (await toggle.boundingBox())!;
  expect([aiBounds.width, aiBounds.height]).toEqual([commandBounds.width, commandBounds.height]);
  const border = await page.locator('.application-window').evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { radius: style.borderTopLeftRadius, hit: style.pointerEvents, width: style.borderTopWidth, platform: element.getAttribute('data-platform') };
  });
  expect(border.radius).toBe(border.platform === 'macos' ? '10px' : '0px');
  expect(border.hit).toBe('none');
  expect(border.width).toBe('1px');
  await page.screenshot({ path: test.info().outputPath('window-border-and-composer.png') });
});

test('overflow menus retain transparent overlay tracks while dragging and clicking', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const scope = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const invoke = scope.__TAURI_INTERNALS__.invoke;
    scope.__TAURI_INTERNALS__.invoke = (command, args) => command === 'fs_list'
      ? Promise.resolve(Array.from({ length: 40 }, (_, index) => ({ name: `folder-${String(index).padStart(2, '0')}`, path: `/home/e2e/folder-${index}`, is_dir: true }))) : invoke(command, args);
  });
  await page.getByRole('button', { name: '切换工作目录' }).click();
  const list = page.locator('.directory-picker-list');
  await expect(list.getByRole('option')).toHaveCount(41);
  await expect(list).toHaveClass(/overlay-scroll-target/);
  const id = await list.getAttribute('id');
  const bar = page.locator(`[role="scrollbar"][aria-controls="${id}"]`);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const thumb = (await bar.locator('.overlay-scrollbar-thumb').boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + 170, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '选择工作目录' })).toBeVisible();
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(200);
  await expect(list.getByRole('option').first()).not.toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('cwd-overlay-menu.png') });
});

test('horizontal overlay tracks retain content height and support keyboard and drag navigation', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const surface = document.createElement('div');
    surface.id = 'horizontal-fixture';
    Object.assign(surface.style, { position: 'fixed', left: '300px', top: '120px', width: '300px', height: '70px', overflowX: 'auto', overflowY: 'hidden', zIndex: '400', background: 'var(--canvas)' });
    const content = document.createElement('div');
    content.style.width = '900px';
    content.textContent = 'Wide scroll content';
    surface.append(content);
    document.body.append(surface);
  });
  const surface = page.locator('#horizontal-fixture');
  await expect(surface).toHaveClass(/overlay-scroll-target/);
  const bar = page.locator('[role="scrollbar"][aria-controls="horizontal-fixture"]');
  await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await surface.evaluate(element => element.clientHeight)).toBe(70);
  await bar.focus();
  await bar.press('End');
  await expect.poll(() => surface.evaluate(element => element.scrollLeft)).toBe(600);
  const thumb = (await bar.locator('.overlay-scrollbar-thumb').boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x - 80, thumb.y + thumb.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => surface.evaluate(element => element.scrollLeft)).toBeLessThan(400);
});

test('latest-output arrow resumes following during a foreground command', async ({ page }) => {
  await ready(page);
  const lines = Array.from({ length: 80 }, (_, index) => `running-line-${index}`).join('\r\n');
  await emitPtyOutput(page, `\x1b]133;E;${btoa('running-demo')}\x07\x1b]133;C\x07${lines}\r\n`);
  const button = page.getByRole('button', { name: '回到最新输出' });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('data-tip-shortcut', 'End');
  const region = page.locator('[data-testid^="terminal-scroll-"]').first();
  await region.evaluate(element => { element.scrollTop = 0; });
  await expect.poll(() => region.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(100);
  await button.click();
  await expect.poll(() => region.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(32);
});
