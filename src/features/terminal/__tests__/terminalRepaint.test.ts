import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const { terminals, renderer, debug } = vi.hoisted(() => ({
  terminals: new Map<string, Terminal>(),
  renderer: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../stores/terminal', () => ({ termInstances: terminals, getFocusedTerminalId: () => 'focused' }));
vi.mock('../model/xtermRenderer', () => ({ applyTerminalRenderer: renderer }));
vi.mock('../services/terminalDebug', () => ({ terminalDebug: debug }));
import {
  blockTerminalFor,
  recoverTerminalSurfaces,
  redrawTerminal,
  registerBlockTerminal,
  unregisterBlockTerminal,
} from '../services/terminalRepaint';
import { useTypographyStore } from '@config/typography';

function surface() {
  return { element: document.createElement('div'), rows: 24, clearTextureAtlas: vi.fn(), refresh: vi.fn(), reset: vi.fn() };
}

describe('terminal surface resets', () => {
  let registered: Array<[string, Terminal]> = [];
  beforeEach(() => {
    for (const [paneId, term] of registered) unregisterBlockTerminal(paneId, term);
    registered = [];
    terminals.clear();
    renderer.mockClear();
    debug.mockClear();
    useTypographyStore.setState({ terminalRenderer: 'webgl' });
  });
  function registerBlock(paneId: string, term: Terminal): void {
    registerBlockTerminal(paneId, term);
    registered.push([paneId, term]);
  }

  it('rebuilds the requested pane and rebuilds every live terminal after one atlas wipe', () => {
    const main = surface();
    const block = surface();
    const otherPane = surface();
    terminals.set('focused', main as unknown as Terminal);
    terminals.set('other', otherPane as unknown as Terminal);
    registerBlock('focused', block as unknown as Terminal);

    redrawTerminal();

    // The pane the action was invoked on gets a fresh renderer for both of its surfaces.
    for (const term of [main, block]) {
      expect(renderer).toHaveBeenCalledWith(term, 'dom');
      expect(renderer).toHaveBeenCalledWith(term, 'webgl');
    }
    expect(renderer).not.toHaveBeenCalledWith(otherPane, 'dom');
    // The glyph atlas is shared by every WebGL terminal, so it is cleared exactly once and every
    // live terminal rebuilds from its buffer afterwards - including the other pane's terminal.
    const wipes = [main, block, otherPane].flatMap(term => term.clearTextureAtlas.mock.calls);
    expect(wipes).toHaveLength(1);
    for (const term of [main, block, otherPane]) {
      expect(term.refresh).toHaveBeenCalledWith(0, 23);
      expect(term.reset).not.toHaveBeenCalled();
    }
  });

  it('redraws an explicitly requested pane once and honors the DOM preference', () => {
    const term = surface();
    terminals.set('other', term as unknown as Terminal);
    useTypographyStore.setState({ terminalRenderer: 'dom' });
    redrawTerminal('other');
    expect(term.refresh).toHaveBeenCalledOnce();
    expect(renderer.mock.calls.every(([, preference]) => preference === 'dom')).toBe(true);
  });

  it('does nothing for a settings page or an unopened terminal', () => {
    redrawTerminal();
    terminals.set('focused', { rows: 24 } as Terminal);
    redrawTerminal();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('restores only the terminal input that held focus before rebuilding its renderer', () => {
    const main = surface();
    const input = document.createElement('textarea');
    input.className = 'xterm-helper-textarea';
    main.element.append(input); document.body.append(main.element);
    const focus = vi.fn(() => input.focus());
    terminals.set('focused', { ...main, focus } as unknown as Terminal);
    input.focus();
    renderer.mockImplementation(() => input.blur());
    redrawTerminal();
    expect(focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
    main.element.remove(); renderer.mockReset();
  });

  it('coalesces the window-restore reset so the shared atlas is cleared once per event', async () => {
    const main = surface();
    const block = surface();
    const otherPane = surface();
    terminals.set('focused', main as unknown as Terminal);
    terminals.set('other', otherPane as unknown as Terminal);
    registerBlock('focused', block as unknown as Terminal);

    recoverTerminalSurfaces();
    recoverTerminalSurfaces();
    recoverTerminalSurfaces();
    await Promise.resolve();

    expect([main, block, otherPane].flatMap(term => term.clearTextureAtlas.mock.calls)).toHaveLength(1);
    expect([main, block, otherPane].every(term => term.refresh.mock.calls.length === 1)).toBe(true);
    // A context lost while the window was hidden is re-attached for every live terminal.
    for (const term of [main, block, otherPane]) {
      expect(renderer).toHaveBeenCalledWith(term, 'webgl');
    }
  });

  it('keeps the recovery path usable when a reset fails', async () => {
    const main = surface();
    terminals.set('focused', main as unknown as Terminal);
    main.clearTextureAtlas.mockImplementation(() => { throw new Error('context gone'); });

    recoverTerminalSurfaces();
    await Promise.resolve();
    expect(main.refresh).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith('terminal-surface-reset-error', expect.objectContaining({ reason: 'window-restore' }));

    // The failed reset must not leave the coalescing latch closed for the rest of the session.
    main.clearTextureAtlas.mockImplementation(() => {});
    recoverTerminalSurfaces();
    await Promise.resolve();
    expect(main.refresh).toHaveBeenCalledOnce();
  });

  it('tracks the pane block terminal for the lifetime of a running command', () => {
    const block = surface() as unknown as Terminal;
    expect(blockTerminalFor('focused')).toBeNull();
    registerBlock('focused', block);
    expect(blockTerminalFor('focused')).toBe(block);
    unregisterBlockTerminal('focused', block);
    expect(blockTerminalFor('focused')).toBeNull();
  });
});
