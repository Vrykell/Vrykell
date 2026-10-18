import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { diagnostic, diagnosticSnapshot, exportDiagnostics, flushDiagnostics, invoke, redactText, reportFrameGap, reportWindowFocus, sanitizeDiagnostic, setDiagnosticAutoSave, useDiagnosticSettings } from './diagnostics';

describe('diagnostics', () => {
  beforeEach(async () => {
    await flushDiagnostics();
    invokeMock.mockReset().mockResolvedValue(undefined);
    useDiagnosticSettings.setState({ autoSave: false, saving: false, error: null });
  });
  afterEach(async () => { await flushDiagnostics(); vi.useRealTimers(); });

  it('keeps auto save disabled by default and exports credential-safe detailed context', () => {
    expect(useDiagnosticSettings.getState().autoSave).toBe(false);
    const detail = sanitizeDiagnostic({ error: new Error('SFTP handshake failed'), columns: 132, password: 'do-not-save', data: 'secret terminal screen' });
    expect(detail).toMatchObject({ error: { name: 'Error', message: 'SFTP handshake failed' }, columns: 132, password: '[redacted]', data: { redacted: true, length: 22 } });
    expect(JSON.stringify(detail)).not.toContain('do-not-save');
  });

  it('records invocation durations and failures while excluding request secrets', async () => {
    const before = diagnosticSnapshot().length;
    invokeMock.mockRejectedValueOnce(new Error('failed Bearer never-export-this'));
    await expect(invoke('ssh_connect', { host: 'example.test', password: 'secret' })).rejects.toThrow('never-export-this');
    const records = diagnosticSnapshot().slice(before);
    expect(records.map(record => record.event)).toEqual(['ipc-start', 'ipc-error']);
    expect(JSON.stringify(records)).toContain('example.test');
    expect(JSON.stringify(records)).not.toContain('secret');
    expect(JSON.stringify(records)).not.toContain('never-export-this');
    expect(JSON.stringify(records)).toContain('durationMs');
  });

  it('persists the default-off setting only after the backend accepts it', async () => {
    await setDiagnosticAutoSave(true);
    expect(useDiagnosticSettings.getState().autoSave).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('diagnostics_set_auto_save', { enabled: true });
    invokeMock.mockImplementation(command => command === 'diagnostics_set_auto_save'
      ? Promise.reject(new Error('disk denied')) : Promise.resolve(undefined));
    await expect(setDiagnosticAutoSave(false)).rejects.toThrow('disk denied');
    expect(useDiagnosticSettings.getState().autoSave).toBe(true);
    expect(useDiagnosticSettings.getState().error).toContain('disk denied');
  });

  it('redacts API credentials embedded in error strings', () => {
    expect(redactText('401 Bearer abc sk-api-secret token=private')).toBe('401 Bearer [redacted] [redacted] token=[redacted]');
  });

  it('batches frequent input diagnostics without dropping records or exposing secrets', async () => {
    useDiagnosticSettings.setState({ autoSave: true });
    for (let index = 0; index < 130; index++) diagnostic('input-fixture', { index, password: 'private-value' });
    await flushDiagnostics();
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'terminal_debug_records');
    expect(calls).toHaveLength(3);
    const records = calls.flatMap(([, args]) => args.records);
    expect(records.map(record => record.detail.index)).toEqual(Array.from({ length: 130 }, (_, index) => index));
    expect(JSON.stringify(records)).not.toContain('private-value');
  });

  it('flushes an incomplete batch on the timer and before exporting', async () => {
    vi.useFakeTimers();
    useDiagnosticSettings.setState({ autoSave: true });
    diagnostic('first-input');
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(invokeMock).toHaveBeenCalledWith('terminal_debug_records', expect.any(Object));
    diagnostic('last-input');
    await exportDiagnostics('/tmp/fixture.jsonl');
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['terminal_debug_records', 'terminal_debug_records', 'diagnostics_export']);
  });

  it('surfaces write failures and still delivers later diagnostic batches', async () => {
    useDiagnosticSettings.setState({ autoSave: true });
    invokeMock.mockRejectedValueOnce(new Error('disk denied'));
    diagnostic('failed-batch');
    await flushDiagnostics();
    expect(useDiagnosticSettings.getState().error).toContain('disk denied');
    diagnostic('next-batch');
    await flushDiagnostics();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('separates a stalled main thread from a paused window in the frame gaps', () => {
    const before = diagnosticSnapshot().length;
    reportFrameGap(120);
    reportFrameGap(300);
    reportFrameGap(9000);
    const records = diagnosticSnapshot().slice(before);
    expect(records.map(record => record.event)).toEqual(['frame-stall', 'frame-pause']);
    expect(records[0]!.detail).toMatchObject({ gapMs: 300, visibility: expect.any(String), hasFocus: expect.any(Boolean) });
    expect(records[1]!.detail).toMatchObject({ gapMs: 9000 });
  });

  it('records the window focus transitions with the platform visibility', () => {
    const before = diagnosticSnapshot().length;
    reportWindowFocus(false);
    reportWindowFocus(true);
    const records = diagnosticSnapshot().slice(before);
    expect(records.map(record => record.event)).toEqual(['window-blur', 'window-focus']);
    expect(records[0]!.detail).toMatchObject({ visibility: expect.any(String), hasFocus: expect.any(Boolean) });
  });
});
