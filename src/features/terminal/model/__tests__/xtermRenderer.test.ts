import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const mocked = vi.hoisted(() => ({
  handlers: [] as Array<() => void>,
  disposed: 0,
  fail: false,
  extensions: [] as string[],
  loseContext: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    // Mirrors the private renderer handle the terminal surface adapter reaches for.
    readonly _renderer = {
      _gl: {
        getExtension: (name: string) => {
          mocked.extensions.push(name);
          return { loseContext: mocked.loseContext };
        },
      },
    };
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

vi.mock('@features/terminal/services/terminalDebug', () => ({ terminalDebug: mocked.debug }));

import { applyTerminalRenderer, loadWebglRenderer, releaseTerminalRenderer } from '../xtermRenderer';

function reset(): void {
  mocked.handlers.length = 0;
  mocked.disposed = 0;
  mocked.fail = false;
  mocked.extensions.length = 0;
  mocked.loseContext.mockClear();
  mocked.debug.mockClear();
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

describe('WebGL context lifetime', () => {
  beforeEach(reset);

  it('hands the GPU context back when the renderer is dropped', () => {
    const { term } = fakeTerminal();
    loadWebglRenderer(term, 'webgl');
    applyTerminalRenderer(term, 'dom');
    // The context is explicitly released: browsers cap live contexts per document and drop the
    // oldest one, which blanks a terminal nobody touched.
    expect(mocked.extensions).toEqual(['WEBGL_lose_context']);
    expect(mocked.loseContext).toHaveBeenCalledOnce();
    expect(mocked.debug).toHaveBeenCalledWith('terminal-webgl-context-released', { released: expect.any(Number) });
  });

  it('releases the context of a terminal that is about to be disposed, and only once', () => {
    const { term } = fakeTerminal();
    loadWebglRenderer(term, 'webgl');
    releaseTerminalRenderer(term);
    releaseTerminalRenderer(term);
    expect(mocked.disposed).toBe(1);
    expect(mocked.loseContext).toHaveBeenCalledOnce();
  });

  it('keeps working when the context is already gone', () => {
    const { term } = fakeTerminal();
    loadWebglRenderer(term, 'webgl');
    mocked.loseContext.mockImplementation(() => { throw new Error('context lost'); });
    expect(() => applyTerminalRenderer(term, 'dom')).not.toThrow();
    expect(mocked.disposed).toBe(1);
  });
});
