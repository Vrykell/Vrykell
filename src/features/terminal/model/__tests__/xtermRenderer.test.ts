import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const mocked = vi.hoisted(() => ({
  handlers: [] as Array<() => void>,
  disposed: 0,
  fail: false,
  extensions: [] as string[],
  loseContext: vi.fn(),
  debug: vi.fn(),
  canvas: undefined as HTMLCanvasElement | undefined,
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    // Mirrors the private renderer handle the terminal surface adapter reaches for.
    readonly _renderer = {
      _canvas: mocked.canvas,
      dimensions: { device: { canvas: { width: 100, height: 40 } } },
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

import { applyTerminalRenderer, hasWebglRenderer, loadWebglRenderer, releaseTerminalRenderer } from '../xtermRenderer';

function reset(): void {
  mocked.canvas?.remove();
  mocked.canvas = undefined;
  mocked.handlers.length = 0;
  mocked.disposed = 0;
  mocked.fail = false;
  mocked.extensions.length = 0;
  mocked.loseContext.mockClear();
  mocked.debug.mockClear();
}

function fakeTerminal() {
  const loadAddon = vi.fn();
  const renders = new Set<() => void>();
  return { term: { loadAddon, rows: 24, refresh: vi.fn(), onRender: (handler: () => void) => {
    renders.add(handler); return { dispose: () => renders.delete(handler) };
  } } as unknown as Terminal, loadAddon, render: () => { for (const handler of renders) handler(); } };
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

  it('checks deferred activation when a plugin is loaded before the terminal opens', () => {
    const { term, loadAddon, render } = fakeTerminal();
    loadWebglRenderer(term);
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 32;
    document.body.appendChild(canvas); mocked.canvas = canvas;
    const addon = loadAddon.mock.calls[0][0] as { _renderer: { _canvas?: HTMLCanvasElement } };
    addon._renderer._canvas = canvas;
    render();
    expect(hasWebglRenderer(term)).toBe(false);
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
    expect(mocked.disposed).toBe(1);
  });

  it('retains the buffer with a DOM fallback when backing pixels disagree with the GPU grid', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 40; document.body.appendChild(canvas); mocked.canvas = canvas;
    const { term, loadAddon } = fakeTerminal();
    loadWebglRenderer(term);
    canvas.width = 80;
    await vi.waitFor(() => expect(hasWebglRenderer(term)).toBe(false));
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
    expect(mocked.debug).toHaveBeenCalledWith('terminal-renderer-fallback', expect.objectContaining({ reason: 'backing-size', width: 80, expectedWidth: 100 }));
    applyTerminalRenderer(term, 'webgl');
    expect(loadAddon).toHaveBeenCalledTimes(1);
    applyTerminalRenderer(term, 'dom'); applyTerminalRenderer(term, 'webgl');
    expect(loadAddon).toHaveBeenCalledTimes(2);
    releaseTerminalRenderer(term);
  });

  it('allows a device-pixel rounding difference and stops observing a released renderer', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 40; document.body.appendChild(canvas); mocked.canvas = canvas;
    const { term } = fakeTerminal();
    loadWebglRenderer(term); canvas.width = 99;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(hasWebglRenderer(term)).toBe(true);
    releaseTerminalRenderer(term); canvas.width = 50;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocked.disposed).toBe(1);
    expect(term.refresh).not.toHaveBeenCalled();
  });

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

  it('reports a context loss and the renderer the terminal falls back to', () => {
    const { term } = fakeTerminal();
    loadWebglRenderer(term, 'webgl');
    expect(hasWebglRenderer(term)).toBe(true);
    mocked.handlers[0]!();
    // The loss is recorded apart from an ordinary release so a silent step down to the DOM
    // renderer can be told from a terminal that was disposed on purpose.
    expect(mocked.debug).toHaveBeenCalledWith('terminal-webgl-context-lost', { released: expect.any(Number), attached: false });
    expect(hasWebglRenderer(term)).toBe(false);
  });
});
