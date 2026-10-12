import { expect, test } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites, expectAnyTermContains } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, '\x1b]133;E;dm0=\x07\x1b]133;C\x07\x1b[?1049hSTATIC TUI');
  await expectAnyTermContains(page, 'STATIC TUI');
});

test('native candidate confirmation sends committed text once without preedit or Enter', async ({ page }) => {
  const before = (await ptyWrites(page)).length;
  await page.locator('.xterm:visible .xterm-helper-textarea').first().evaluate(async node => {
    const input = node as HTMLTextAreaElement;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'nihao';
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'nihao' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'nihao', isComposing: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
    // A native candidate key can arrive with an ordinary Enter code.
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
    input.value = '你好';
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '你好' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromComposition', data: '你好' }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: '你好' }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect((await ptyWrites(page)).slice(before)).toEqual(['你好']);
  await page.keyboard.type('a');
  await expect.poll(async () => (await ptyWrites(page)).slice(before).join('')).toBe('你好a');
});

test('native punctuation after composition does not replay the previous commit', async ({ page }) => {
  const before = (await ptyWrites(page)).length;
  await page.locator('.xterm:visible .xterm-helper-textarea').first().evaluate(async node => {
    const input = node as HTMLTextAreaElement;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'nihao';
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'nihao' }));
    await new Promise(resolve => setTimeout(resolve, 10));
    input.value = '';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteCompositionText' }));
    input.value = '你好';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromComposition', data: '你好', isComposing: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    // Native punctuation can end a composition without starting a new one.
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
    input.value += '，';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromComposition', data: '，', isComposing: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '，' }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect((await ptyWrites(page)).slice(before)).toEqual(['你好', '，']);
});

test('returning to a static TUI repaints its canvas without new PTY output', async ({ page }) => {
  const original = await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    return useWorkspaceStore.getState().activeId;
  });
  const canvas = page.locator('.xterm:visible .xterm-screen canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const clip = { x: bounds!.x, y: bounds!.y, width: 60, height: 16 };
  const originalPixels = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
    for (const [id, term] of terms) {
      if (id.startsWith('block:')) continue;
      const clear = term.clearTextureAtlas.bind(term);
      term.clearTextureAtlas = () => {
        (window as unknown as { __surfaceRestores: number }).__surfaceRestores++;
        clear();
      };
    }
    (window as unknown as { __surfaceRestores: number }).__surfaceRestores = 0;
  });
  const other = await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    return useWorkspaceStore.getState().addTab();
  });
  await expect(page.getByText('TUI', { exact: true })).not.toBeVisible();
  await page.evaluate(async id => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().activate(id);
  }, original);
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __surfaceRestores: number }).__surfaceRestores)).toBeGreaterThan(0);
  await expectAnyTermContains(page, 'STATIC TUI');
  expect(await page.screenshot({ clip, animations: 'disabled' })).toEqual(originalPixels);
  const restored = await page.evaluate(() => (window as unknown as { __surfaceRestores: number }).__surfaceRestores);
  await page.evaluate(async ({ original, other }) => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    // A round trip in one task need not yield a zero-size observer notification.
    useWorkspaceStore.getState().activate(other);
    useWorkspaceStore.getState().activate(original);
  }, { original, other });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __surfaceRestores: number }).__surfaceRestores)).toBeGreaterThan(restored);
  await canvas.screenshot({ path: test.info().outputPath('restored-static-tui.png') });
});

test('redraw shortcut, toolbar and palette preserve the TUI without sending PTY input', async ({ page }) => {
  const before = await ptyWrites(page);
  const input = page.locator('.xterm:visible .xterm-helper-textarea').first();
  await input.focus();
  await page.keyboard.press('Control+Shift+R');
  await expect(page.getByTestId('tui-banner')).toBeVisible();
  await expectAnyTermContains(page, 'STATIC TUI');
  await page.clock.pauseAt(new Date());
  const redraw = page.getByTestId('tui-banner').locator('[data-tip="重绘终端"]');
  await redraw.click();
  await expect(redraw).toHaveAttribute('aria-busy', 'true');
  await expect(redraw).toBeDisabled();
  await expect(redraw.locator('svg')).toHaveCSS('animation-name', 'spin');
  await page.clock.runFor(850);
  await expect(redraw).toHaveAttribute('aria-busy', 'false');
  await expect(redraw).toBeEnabled();
  await expect(redraw.locator('svg')).toHaveCSS('animation-name', 'none');
  await page.clock.resume();
  await expectAnyTermContains(page, 'STATIC TUI');
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: '命令面板' });
  await palette.getByPlaceholder('搜索命令…').fill('重绘终端');
  await palette.getByRole('button', { name: /重绘终端/ }).click();
  await expect(palette).not.toBeVisible();
  await expectAnyTermContains(page, 'STATIC TUI');
  expect(await ptyWrites(page)).toEqual(before);
});
