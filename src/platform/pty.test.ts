import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { ptySpawn, ptyWrite, ptyResize, ptyClose, ptyCloseAll, onPtyOutput, ptyInputEpoch } from '@platform/pty';

describe('pty IPC wrapper', () => {
  beforeEach(() => { invokeMock.mockReset(); listenMock.mockReset(); });

  it('pty_spawn passes camelCase arguments and returns the id', async () => {
    invokeMock.mockResolvedValue('sess-1');
    const id = await ptySpawn(80, 24, '/tmp');
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', { cols: 80, rows: 24, cwd: '/tmp', shell: null, ssh: null, openMode: null });
    expect(id).toBe('sess-1');
  });

  it('pty_spawn passes null for a missing cwd', async () => {
    invokeMock.mockResolvedValue('sess-2');
    await ptySpawn(120, 40);
    expect(invokeMock).toHaveBeenCalledWith('pty_spawn', { cols: 120, rows: 40, cwd: null, shell: null, ssh: null, openMode: null });
  });

  it('pty_spawn forwards the shell and ssh target', async () => {
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
      openMode: null,
    });
  });

  it('maps pty_write/resize/close to their commands', async () => {
    invokeMock.mockResolvedValue(undefined);
    await ptyWrite('s', 'ls\n');
    await ptyResize('s', 100, 30);
    await ptyClose('s');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'pty_write', { id: 's', data: 'ls\n' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pty_resize', { id: 's', cols: 100, rows: 30 });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'pty_close', { id: 's' });
  });

  it('pty_close_all returns the number of closed sessions', async () => {
    invokeMock.mockResolvedValue(2);
    await expect(ptyCloseAll()).resolves.toBe(2);
    expect(invokeMock).toHaveBeenCalledWith('pty_close_all');
  });

  it('onPtyOutput unwraps the payload', async () => {
    const cb = vi.fn();
    listenMock.mockResolvedValue(() => {});
    await onPtyOutput(cb);
    const handler = listenMock.mock.calls[0][1];
    const events = [{ kind: 'data', text: 'hello' }];
    handler({ payload: { id: 's', events } });
    expect(cb).toHaveBeenCalledWith('s', events);
  });

  it('rejects native foreground changes before the webview receives their output', async () => {
    listenMock.mockResolvedValue(() => {}); await onPtyOutput(vi.fn());
    listenMock.mock.calls[0][1]({ payload: { id: 'guarded', events: [], inputEpoch: 4 } });
    invokeMock.mockResolvedValueOnce(4);
    await expect(ptyInputEpoch('guarded')).resolves.toBe(4);
    invokeMock.mockResolvedValueOnce(5);
    await expect(ptyInputEpoch('guarded')).rejects.toThrow('terminal input target changed');
    await expect(ptyInputEpoch('unobserved')).rejects.toThrow('terminal input target changed');
    invokeMock.mockResolvedValueOnce(undefined); await ptyWrite('guarded', 'paste', 4);
    expect(invokeMock).toHaveBeenLastCalledWith('pty_write', { id: 'guarded', data: 'paste', expectedEpoch: 4 });
  });
});
