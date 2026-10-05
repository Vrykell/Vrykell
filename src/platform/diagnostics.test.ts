import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { diagnosticSnapshot, invoke, redactText, sanitizeDiagnostic, setDiagnosticAutoSave, useDiagnosticSettings } from './diagnostics';

describe('diagnostics', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue(undefined);
    useDiagnosticSettings.setState({ autoSave: false, saving: false, error: null });
  });

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
    invokeMock.mockRejectedValueOnce(new Error('disk denied'));
    await expect(setDiagnosticAutoSave(false)).rejects.toThrow('disk denied');
    expect(useDiagnosticSettings.getState().autoSave).toBe(true);
    expect(useDiagnosticSettings.getState().error).toContain('disk denied');
  });

  it('redacts API credentials embedded in error strings', () => {
    expect(redactText('401 Bearer abc sk-api-secret token=private')).toBe('401 Bearer [redacted] [redacted] token=[redacted]');
  });
});
