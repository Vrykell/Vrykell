import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { diagnosticSnapshot, useDiagnosticSettings, type DiagnosticRecord } from '@platform/diagnostics';
import { TerminalIoLog, TERMINAL_IO_WINDOW_MS } from '@features/terminal/services/terminalIoLog';
import type { DispatchEvent } from '@core/terminal/events';

const data = (text: string): DispatchEvent => ({ kind: 'data', text });
const osc = (): DispatchEvent => ({ kind: 'osc', code: '0', payload: 'title', raw: '\x1b]0;title\x07' });

/** Terminal pipeline records written since the last snapshot marker. */
const ioRecords = (): DiagnosticRecord[] => diagnosticSnapshot().filter((record) => record.event === 'terminal-io');

describe('terminalIoLog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset().mockResolvedValue(undefined);
    useDiagnosticSettings.setState({ autoSave: true, saving: false, error: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    useDiagnosticSettings.setState({ autoSave: false, saving: false, error: null });
  });

  it('sums a whole window of the pipeline into one record', async () => {
    const before = ioRecords().length;
    const log = new TerminalIoLog('pane-1');
    log.received([data('abcd'), osc()]);
    log.consumed([data('abcd'), osc()], 'altScreen');
    log.routed('main', 4);
    log.routed('main', 10);
    log.routed('block', 8, { blockNotReady: true, echoArmed: true, echoFiltered: true });
    // Nothing is written while the window is open.
    expect(ioRecords()).toHaveLength(before);

    await vi.advanceTimersByTimeAsync(TERMINAL_IO_WINDOW_MS);
    const records = ioRecords().slice(before);
    expect(records).toHaveLength(1);
    expect(records[0]!.detail).toEqual({
      tabId: 'pane-1',
      scene: 'altScreen',
      windowMs: TERMINAL_IO_WINDOW_MS,
      rxBatches: 1,
      rxEvents: 2,
      rxChars: 4,
      rxOsc: 1,
      rxAlt: 0,
      ctlBatches: 1,
      ctlEvents: 2,
      mainChunks: 2,
      mainChars: 14,
      blockChunks: 1,
      blockChars: 8,
      earlyChunks: 0,
      earlyChars: 0,
      maxChars: 10,
      blockNotReady: 1,
      echoArmed: 1,
      echoFiltered: 1,
    });

    // A quiet pane writes nothing more; the next window starts from zero.
    await vi.advanceTimersByTimeAsync(TERMINAL_IO_WINDOW_MS * 2);
    expect(ioRecords()).toHaveLength(before + 1);
    log.routed('early', 3);
    await vi.advanceTimersByTimeAsync(TERMINAL_IO_WINDOW_MS);
    const [, second] = ioRecords().slice(before);
    expect(second!.detail).toMatchObject({
      rxBatches: 0,
      ctlBatches: 0,
      earlyChunks: 1,
      earlyChars: 3,
      maxChars: 3,
      scene: null,
    });
  });

  it('counts every alt-screen event and keeps the last scene of the window', async () => {
    const before = ioRecords().length;
    const log = new TerminalIoLog('pane-2');
    log.received([{ kind: 'altEnter', raw: '\x1b[?1049h' }]);
    log.consumed([{ kind: 'altEnter', raw: '\x1b[?1049h' }], 'classic');
    log.received([{ kind: 'altExit', raw: '\x1b[?1049l' }]);
    log.consumed([{ kind: 'altExit', raw: '\x1b[?1049l' }], 'altScreen');
    await vi.advanceTimersByTimeAsync(TERMINAL_IO_WINDOW_MS);
    const record = ioRecords().slice(before)[0]!;
    expect(record.detail).toMatchObject({ rxBatches: 2, rxEvents: 2, rxAlt: 2, ctlBatches: 2, ctlEvents: 2, scene: 'altScreen' });
  });

  it('stays silent while detailed logging is off', async () => {
    useDiagnosticSettings.setState({ autoSave: false });
    const before = ioRecords().length;
    const log = new TerminalIoLog('pane-3');
    log.received([data('x')]);
    log.consumed([data('x')], 'classic');
    log.routed('main', 1);
    await vi.advanceTimersByTimeAsync(TERMINAL_IO_WINDOW_MS * 3);
    expect(ioRecords()).toHaveLength(before);
  });

  it('keeps the open window when the pane goes away, then drops it', async () => {
    const before = ioRecords().length;
    const log = new TerminalIoLog('pane-4');
    log.routed('main', 3);
    log.flush();
    expect(ioRecords().slice(before)[0]!.detail).toMatchObject({ mainChunks: 1, mainChars: 3 });

    log.routed('main', 5);
    log.dispose();
    await vi.advanceTimersByTimeAsync(TERMINAL_IO_WINDOW_MS * 2);
    expect(ioRecords()).toHaveLength(before + 1);
  });
});
