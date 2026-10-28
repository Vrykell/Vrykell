import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { killForeground } from '@utils/killForeground';

describe('killForeground (escalation decisions moved down to Rust)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('term');
  });

  it('calls pty_kill_foreground and passes the backend level through', async () => {
    invokeMock.mockResolvedValue('kill');
    const level = await killForeground('s1');
    expect(level).toBe('kill');
    expect(invokeMock).toHaveBeenCalledWith('pty_kill_foreground', { id: 's1' });
  });

  it('propagates the error when the backend refuses', async () => {
    invokeMock.mockRejectedValueOnce(new Error('前台是 shell 本身'));
    await expect(killForeground('s1')).rejects.toThrow('前台是 shell 本身');
  });
});
