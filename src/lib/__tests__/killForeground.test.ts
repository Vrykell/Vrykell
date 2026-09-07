import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { killForeground } from '@/lib/killForeground';

describe('killForeground（升级决策已下沉 Rust）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('term');
  });

  it('调用 pty_kill_foreground 并透传后端级别', async () => {
    invokeMock.mockResolvedValue('kill');
    const level = await killForeground('s1');
    expect(level).toBe('kill');
    expect(invokeMock).toHaveBeenCalledWith('pty_kill_foreground', { id: 's1' });
  });

  it('后端拒绝时错误透传', async () => {
    invokeMock.mockRejectedValueOnce(new Error('前台是 shell 本身'));
    await expect(killForeground('s1')).rejects.toThrow('前台是 shell 本身');
  });
});
