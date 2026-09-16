/**
 * shells — shell 类型标签与可用 shell 列表。
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { shellTypeLabel, fallbackShells, getAvailableShells, listShells } from '@/lib/shells';

describe('shells', () => {
  it('shellTypeLabel 映射与兜底', () => {
    expect(shellTypeLabel('zsh')).toBe('Zsh');
    expect(shellTypeLabel('cmd')).toBe('CMD');
    expect(shellTypeLabel('powershell')).toBe('PowerShell');
    expect(shellTypeLabel('weird')).toBe('weird');
    expect(shellTypeLabel('')).toBe('终端');
  });

  it('fallbackShells 返回结构完整的选项', () => {
    const shells = fallbackShells();
    expect(shells.length).toBeGreaterThan(0);
    expect(shells.some((s) => s.default)).toBe(true);
  });

  it('getAvailableShells：有结果用结果，空/失败回退', async () => {
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

  it('shellTypeLabel：bash / pwsh 映射', () => {
    expect(shellTypeLabel('bash')).toBe('Bash');
    expect(shellTypeLabel('pwsh')).toBe('PowerShell');
  });
});
