/**
 * shells — shell type labels and the available shell list.
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { shellTypeLabel, fallbackShells, getAvailableShells, listShells } from '@platform/shells';
import { t } from '@i18n';

describe('shells', () => {
  it('maps shellTypeLabel and falls back', () => {
    expect(shellTypeLabel('zsh')).toBe('Zsh');
    expect(shellTypeLabel('cmd')).toBe('CMD');
    expect(shellTypeLabel('powershell')).toBe('Windows PowerShell');
    expect(shellTypeLabel('weird')).toBe('weird');
    expect(shellTypeLabel('')).toBe(t('Terminal'));
  });

  it('fallbackShells returns structurally complete options', () => {
    const shells = fallbackShells();
    expect(shells.length).toBeGreaterThan(0);
    expect(shells.some((s) => s.default)).toBe(true);
  });

  it('getAvailableShells: uses results when available, falls back on empty or failure', async () => {
    invokeMock.mockResolvedValueOnce([{ id: 'bash', label: 'Bash', default: true }]);
    const r = await getAvailableShells();
    expect(r[0]!.id).toBe('bash');
    invokeMock.mockResolvedValueOnce([]);
    const empty = await getAvailableShells();
    expect(empty.length).toBeGreaterThan(0);
    invokeMock.mockRejectedValueOnce(new Error('no backend'));
    const fallback = await getAvailableShells();
    expect(fallback.length).toBeGreaterThan(0);
    invokeMock.mockResolvedValueOnce([{ id: 'bash', label: 'Bash', default: true }]);
    expect(await listShells()).toEqual([{ id: 'bash', label: 'Bash', default: true }]);
  });

  it('shellTypeLabel: bash / pwsh mapping (the two PowerShell variants must have different labels)', () => {
    expect(shellTypeLabel('bash')).toBe('Bash');
    expect(shellTypeLabel('pwsh')).toBe('PowerShell 7');
    expect(shellTypeLabel('pwsh')).not.toBe(shellTypeLabel('powershell'));
  });
});
