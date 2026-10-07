import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { applyTerminalRenderer, loadWebglRenderer } from '../xtermRenderer';

const mocked = vi.hoisted(() => ({
  handlers: [] as Array<() => void>,
  disposed: 0,
  fail: false,
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      if (mocked.fail) throw new Error('no webgl');
    }
    onContextLoss(handler: () => void) {
      mocked.handlers.push(handler);
      return { dispose: () => {} };
    }
    dispose() {
      mocked.disposed += 1;
    }
  },
}));

function reset(): void {
  mocked.handlers.length = 0;
  mocked.disposed = 0;
  mocked.fail = false;
}

function fakeTerminal(): { term: Terminal; loadAddon: ReturnType<typeof vi.fn> } {
  const loadAddon = vi.fn();
  return { term: { loadAddon } as unknown as Terminal, loadAddon };
}

describe('loadWebglRenderer', () => {
  it('loads the WebGL renderer into the terminal', () => {
    reset();
    const { term, loadAddon } = fakeTerminal();
    loadWebglRenderer(term);
    expect(loadAddon).toHaveBeenCalledTimes(1);
  });

  it('disposes the addon on context loss so the terminal falls back to the DOM renderer', () => {
    reset();
    const { term } = fakeTerminal();
    loadWebglRenderer(term);
    expect(mocked.handlers).toHaveLength(1);
    mocked.handlers[0]!();
    expect(mocked.disposed).toBe(1);
  });

  it('keeps the DOM renderer when WebGL is unavailable', () => {
    reset();
    mocked.fail = true;
    const { term, loadAddon } = fakeTerminal();
    expect(() => loadWebglRenderer(term)).not.toThrow();
    expect(loadAddon).not.toHaveBeenCalled();
  });

  it('skips the addon when the stored preference is the DOM renderer', () => {
    reset();
    const { term, loadAddon } = fakeTerminal();
    loadWebglRenderer(term, 'dom');
    expect(loadAddon).not.toHaveBeenCalled();
  });

  it('applies a preference change to an open terminal in both directions', () => {
    reset();
    const { term, loadAddon } = fakeTerminal();
    loadWebglRenderer(term, 'webgl');
    expect(loadAddon).toHaveBeenCalledTimes(1);

    applyTerminalRenderer(term, 'dom');
    expect(mocked.disposed).toBe(1);
    applyTerminalRenderer(term, 'dom');
    expect(mocked.disposed).toBe(1);

    applyTerminalRenderer(term, 'webgl');
    expect(loadAddon).toHaveBeenCalledTimes(2);
  });
});
