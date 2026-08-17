import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput } from './pty';

describe('pty IPC wrapper', () => {
  beforeEach(() => { invokeMock.mockReset(); listenMock.mockReset(); });

  it('pty_spawn 传 camelCase 参数并返回 id', async () => {
    invokeMock.mockResolvedValue('sess-1');
    const id = await ptySpawn(80, 24, '/tmp');
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', { cols: 80, rows: 24, cwd: '/tmp', shell: null, ssh: null });
    expect(id).toBe('sess-1');
  });

  it('pty_spawn 缺省 cwd 传 null', async () => {
    invokeMock.mockResolvedValue('sess-2');
    await ptySpawn(120, 40);
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', { cols: 120, rows: 40, cwd: null, shell: null, ssh: null });
  });

  it('pty_spawn 透传 shell 与 ssh 目标', async () => {
    invokeMock.mockResolvedValue('sess-3');
    await ptySpawn(80, 24, undefined, {
      shell: 'zsh',
      ssh: { host: 'prod.example.com', user: 'root', port: 22 },
    });
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', {
      cols: 80,
      rows: 24,
      cwd: null,
      shell: 'zsh',
      ssh: { host: 'prod.example.com', user: 'root', port: 22 },
    });
  });

  it('pty_write/resize/close 映射到对应 command', async () => {
    invokeMock.mockResolvedValue(undefined);
    await ptyWrite('s', 'ls\n');
    await ptyResize('s', 100, 30);
    await ptyClose('s');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'pty_write', { id: 's', data: 'ls\n' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pty_resize', { id: 's', cols: 100, rows: 30 });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'pty_close', { id: 's' });
  });

  it('onPtyOutput 解包 payload', async () => {
    const cb = vi.fn();
    listenMock.mockResolvedValue(() => {});
    await onPtyOutput(cb);
    const handler = listenMock.mock.calls[0][1];
    const events = [{ kind: 'data', text: 'hello' }];
    handler({ payload: { id: 's', events } });
    expect(cb).toHaveBeenCalledWith('s', events);
  });
});
