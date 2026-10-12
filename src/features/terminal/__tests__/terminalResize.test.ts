import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { createResizeQueue, fitTerminal, repaintTerminal } from '../model/terminalResize';

describe('terminal resizing', () => {
  it('repaints the whole viewport from the buffer after the pane was hidden', () => {
    const refresh = vi.fn();
    const clearTextureAtlas = vi.fn();
    repaintTerminal({ rows: 24, refresh, clearTextureAtlas } as unknown as Terminal);
    expect(clearTextureAtlas).toHaveBeenCalledOnce();
    expect(clearTextureAtlas.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]!);
    expect(refresh).toHaveBeenCalledWith(0, 23);
    // A terminal that has not laid out yet has no rows to repaint.
    repaintTerminal({ rows: 0, refresh } as unknown as Terminal);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('repaints resized pixels before presenting the frame and ignores unchanged dimensions', () => {
    const calls: string[] = [];
    const renderer = { _renderRows: vi.fn(() => calls.push('paint')) };
    const term = { cols: 80, rows: 24, _core: { _renderService: renderer },
      resize(cols: number, rows: number) { calls.push('resize'); this.cols = cols; this.rows = rows; },
    };
    const fit = { proposeDimensions: () => ({ cols: 100, rows: 30 }) };
    fitTerminal(term as unknown as Terminal, fit as FitAddon);
    expect(calls).toEqual(['resize', 'paint']);
    expect(renderer._renderRows).toHaveBeenCalledWith(0, 29);
    fitTerminal(term as unknown as Terminal, fit as FitAddon);
    expect(calls).toEqual(['resize', 'paint']);
  });

  it('preserves immediate response while coalescing sizes behind a slow PTY', async () => {
    const complete: Array<() => void> = [];
    const send = vi.fn(() => new Promise<void>(resolve => complete.push(resolve)));
    const queue = createResizeQueue(send);
    queue.request(80, 24);
    expect(send).toHaveBeenCalledWith(80, 24);
    queue.request(79, 24);
    queue.request(78, 24);
    queue.request(77, 24);
    expect(send).toHaveBeenCalledTimes(1);
    complete[0]!();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith(77, 24);
    queue.request(77, 24);
    complete[1]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
    queue.dispose();
    queue.request(70, 24);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retain a stale intermediate size when the host returns to its original width', async () => {
    let finish = () => {};
    const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const queue = createResizeQueue(send);
    queue.request(80, 24);
    queue.request(79, 24);
    queue.request(80, 24);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
