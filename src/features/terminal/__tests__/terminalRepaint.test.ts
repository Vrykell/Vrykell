import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const { terminals, executing, renderer } = vi.hoisted(() => ({
  terminals: new Map<string, Terminal>(),
  executing: vi.fn(),
  renderer: vi.fn(),
}));
vi.mock('../stores/terminal', () => ({ termInstances: terminals, getFocusedTerminalId: () => 'focused' }));
vi.mock('../hooks/useTerminalSession', () => ({ getExecutingTerm: executing }));
vi.mock('../model/xtermRenderer', () => ({ applyTerminalRenderer: renderer }));
import { redrawTerminal } from '../services/terminalRepaint';
import { useTypographyStore } from '@config/typography';

function surface() {
  return { element: document.createElement('div'), rows: 24, clearTextureAtlas: vi.fn(), refresh: vi.fn(), reset: vi.fn() };
}

describe('manual terminal redraw', () => {
  beforeEach(() => {
    terminals.clear();
    executing.mockReset();
    renderer.mockClear();
    useTypographyStore.setState({ terminalRenderer: 'webgl' });
  });

  it('rebuilds the focused main and live surfaces while preserving their buffers', () => {
    const main = surface();
    const live = surface();
    terminals.set('focused', main as unknown as Terminal);
    executing.mockReturnValue({ term: live });
    redrawTerminal();
    for (const term of [main, live]) {
      expect(renderer).toHaveBeenCalledWith(term, 'dom');
      expect(renderer).toHaveBeenCalledWith(term, 'webgl');
      expect(term.clearTextureAtlas).toHaveBeenCalledOnce();
      expect(term.refresh).toHaveBeenCalledWith(0, 23);
      expect(term.reset).not.toHaveBeenCalled();
    }
  });

  it('redraws an explicitly requested pane once and honors the DOM preference', () => {
    const term = surface();
    terminals.set('other', term as unknown as Terminal);
    executing.mockReturnValue({ term });
    useTypographyStore.setState({ terminalRenderer: 'dom' });
    redrawTerminal('other');
    expect(executing).toHaveBeenCalledWith('other');
    expect(term.refresh).toHaveBeenCalledOnce();
    expect(renderer.mock.calls.every(([, preference]) => preference === 'dom')).toBe(true);
  });

  it('does nothing for a settings page or an unopened terminal', () => {
    redrawTerminal();
    terminals.set('focused', { rows: 24 } as Terminal);
    redrawTerminal();
    expect(renderer).not.toHaveBeenCalled();
  });
});
