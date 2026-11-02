import { expect, test } from '@playwright/test';
import { emitPtyOutput, expectAnyTermContains, setupTauriMock } from './tauri-mock';

for (const renderer of ['dom', 'webgl']) {
  for (const width of [720, 1240]) {
    test(`classic ${renderer} keeps the cursor visible across split echo at ${width}px`, async ({ page }) => {
      await setupTauriMock(page, { integration: false });
      await page.addInitScript(renderer => {
        localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8,
          state: { global: { openModeByShell: { zsh: 'classic', bash: 'classic' } }, overrides: {} } }));
        localStorage.setItem('vrykell-typography', JSON.stringify({ state: {
          terminalRenderer: renderer, terminalCursorBlink: false,
        } }));
      }, renderer);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const terminal = page.locator('.xterm:visible').first();
      await expect(terminal).toBeVisible();
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBeGreaterThan(0);
      await terminal.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('a');
      await emitPtyOutput(page, '\x1b[?25hready');
      await expectAnyTermContains(page, 'ready');

      const result = await page.evaluate(async renderer => {
        type Term = import('@xterm/xterm').Terminal & { _core: { coreService: { isCursorHidden: boolean } } };
        const scope = window as unknown as { __vrykellTerms: Map<string, Term>;
          __TAURI_INTERNALS__: { emitPtyOutput: (text: string) => void } };
        const term = [...scope.__vrykellTerms.values()][0]!;
        const frames: Array<{ hidden: boolean; paintedCursor: boolean; rowCount: number }> = [];
        const listener = term.onRender(({ start, end }) => frames.push({ hidden: term._core.coreService.isCursorHidden,
          rowCount: end - start + 1,
          paintedCursor: renderer !== 'dom' || Boolean(term.element?.querySelector('.xterm-cursor')) }));
        const emit = (text: string) => new Promise<void>(resolve => {
          const parsed = term.onWriteParsed(() => { parsed.dispose(); resolve(); });
          scope.__TAURI_INTERNALS__.emitPtyOutput(text);
        });
        for (let index = 0; index < 3; index++) {
          await emit(`\x1b[?25lecho-${index}`);
          await new Promise(resolve => setTimeout(resolve, 40));
          await emit('\x1b[?25h');
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }
        const echoText = Array.from({ length: term.buffer.active.length }, (_, row) =>
          term.buffer.active.getLine(row)?.translateToString(true) ?? '').join('');
        await emit('\r\x1b[2K\x1b[?25l');
        const continuousPaints: number[] = [];
        const continuousRows: number[] = [];
        for (let index = 0; index < 8; index++) {
          const before = frames.length;
          await emit('a\x1b[?25h\x1b[?25l');
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          continuousPaints.push(frames.length - before);
          continuousRows.push(...frames.slice(before).map(frame => frame.rowCount));
        }
        await emit('\x1b[?25h');
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        listener.dispose();
        return { frames, continuousPaints, continuousRows, echoText };
      }, renderer);
      expect(result.frames.length).toBeGreaterThan(0);
      expect(result.frames.every(frame => !frame.hidden && frame.paintedCursor)).toBe(true);
      expect(result.continuousPaints.every(count => count > 0)).toBe(true);
      expect(result.continuousRows.every(rows => rows <= 2)).toBe(true);
      expect(result.echoText).toContain('echo-0echo-1echo-2');
      await expectAnyTermContains(page, 'aaaaaaaa');
      await terminal.screenshot({ path: test.info().outputPath(`cursor-${renderer}-${width}.png`), animations: 'disabled' });

      const screen = terminal.locator('.xterm-screen');
      const box = (await screen.boundingBox())!;
      for (let index = 0; index < 6; index++) {
        await page.keyboard.down('a');
        await page.mouse.move(box.x + 20 + index * 5, box.y + 20);
        await expect(screen).toHaveCSS('cursor', 'none');
      }
      await page.keyboard.up('a');
      await expect(terminal).not.toHaveAttribute('data-terminal-typing', 'true');
      await page.keyboard.down('a');
      await page.mouse.click(box.x + 20, box.y + 20);
      await expect(terminal).not.toHaveAttribute('data-terminal-typing', 'true');
      await page.keyboard.up('a');

      // A real persistent hide must still reach the renderer after the short redraw window.
      await emitPtyOutput(page, '\x1b[?25l');
      await expect.poll(() => page.evaluate(() => {
        type Term = import('@xterm/xterm').Terminal & { _core: { coreService: { isCursorHidden: boolean } } };
        const term = [...(window as unknown as { __vrykellTerms: Map<string, Term> }).__vrykellTerms.values()][0]!;
        return term._core.coreService.isCursorHidden;
      })).toBe(true);
      if (renderer === 'dom') await expect(terminal.locator('.xterm-cursor')).toHaveCount(0);
      await emitPtyOutput(page, '\x1b[?25h\x1b[?1049h\x1b[?25l');
      if (renderer === 'dom') await expect(terminal.locator('.xterm-cursor')).toHaveCount(0);
    });
  }
}
