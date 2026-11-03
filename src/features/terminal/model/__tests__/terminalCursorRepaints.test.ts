import { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { smoothTerminalCursorRepaints } from '../terminalCursor';

vi.mock('../../services/terminalDebug', () => ({ terminalDebug: vi.fn(), isTerminalInputTraceEnabled: () => false }));

const cleanups: Array<() => void> = [];

function setup() {
  const term = new Terminal({ cols: 20, rows: 3, cursorBlink: false });
  const core = (term as unknown as {
    _core: { coreService: { isCursorHidden: boolean }; _renderService?: unknown };
  })._core;
  const frames: boolean[] = [];
  const render = vi.fn(() => { frames.push(core.coreService.isCursorHidden); });
  const service = { _renderRows: (_start: number, _end: number) => { render(); },
    refreshRows() {}, handleCursorMove() {} };
  const original = service._renderRows;
  core._renderService = service;
  vi.spyOn(term, 'refresh').mockImplementation((start, end) => {
    void Promise.resolve().then(() => service._renderRows(start, end));
  });
  const dispose = smoothTerminalCursorRepaints(term, 'pane-test');
  cleanups.push(() => { dispose(); term.dispose(); });
  const write = async (data: string) => {
    const parsed = new Promise<void>(resolve => term.write(data, resolve));
    await vi.advanceTimersByTimeAsync(0);
    await parsed;
  };
  return { term, service, original, render, frames, dispose, write };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.useRealTimers();
});

describe('cursor repaint smoothing', () => {
  it('keeps a split echo repaint on screen until the cursor returns while mode queries stay accurate', async () => {
    const { term, service, render, frames, write } = setup();
    const replies: string[] = [];
    term.onData(data => replies.push(data));
    await write('\x1b[?25ltyped');
    service._renderRows(1, 1);
    await vi.advanceTimersByTimeAsync(40);
    expect(render).toHaveBeenCalledOnce();
    expect(frames).toEqual([false]);
    await write('\x1b[?25$p');
    expect(replies).toContain('\x1b[?25;2$y');
    await write('\x1b[?25h');
    service._renderRows(1, 1);
    expect(frames[frames.length - 1]).toBe(false);
    expect(term.refresh).not.toHaveBeenCalled();
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('typed');
    await vi.advanceTimersByTimeAsync(200);
    expect(frames).not.toContain(true);
  });

  it('honors persistent hiding within the deadline even when hiding is repeated', async () => {
    const { service, frames, write } = setup();
    await write('\x1b[?25l');
    service._renderRows(0, 2);
    await vi.advanceTimersByTimeAsync(60);
    await write('\x1b[?25lmore');
    service._renderRows(0, 2);
    await vi.advanceTimersByTimeAsync(40);
    expect(frames).toEqual([false, false, true]);
    service._renderRows(0, 2);
    expect(frames).toEqual([false, false, true, true]);
  });

  it('leaves alternate-screen hiding and explicit output synchronization to the terminal', async () => {
    const { term, service, frames, write } = setup();
    await write('\x1b[?1049h\x1b[?25l');
    service._renderRows(0, 2);
    expect(frames).toEqual([true]);
    await write('\x1b[?2026h');
    expect(term.modes.synchronizedOutputMode).toBe(true);
    await write('\x1b[?2026l');
    expect(term.modes.synchronizedOutputMode).toBe(false);
  });

  it('paints immediately when the buffer switches or the grid is resized during a hold', async () => {
    const { term, service, frames, write } = setup();
    await write('\x1b[?25l');
    service._renderRows(1, 1);
    await write('\x1b[?1049h');
    service._renderRows(0, 2);
    expect(frames).toContain(true);
    await write('\x1b[?1049l\x1b[?25h\x1b[?25l');
    const beforeResize = frames.length;
    vi.spyOn(term, 'cols', 'get').mockReturnValue(30);
    service._renderRows(0, 2);
    expect(frames.length).toBeGreaterThan(beforeResize);
  });

  it('cancels timers and restores normal painting on disposal', async () => {
    const { service, original, render, dispose, write } = setup();
    await write('\x1b[?25l');
    service._renderRows(0, 2);
    dispose();
    expect(service._renderRows).toBe(original);
    await vi.advanceTimersByTimeAsync(200);
    expect(render).toHaveBeenCalledOnce();
    await write('\x1b[?25h\x1b[?25l');
    service._renderRows(0, 2);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('paints each repeated character immediately even when consecutive redraws end with a hidden cursor', async () => {
    const { term, service, frames, write } = setup();
    await write('\x1b[?25l');
    for (let index = 1; index <= 8; index++) {
      await write('a\x1b[?25h\x1b[?25l');
      service._renderRows(0, 0);
      expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('a'.repeat(index));
      expect(frames.length).toBeGreaterThanOrEqual(index);
      expect(frames[frames.length - 1]).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(frames).not.toContain(true);
  });
});
