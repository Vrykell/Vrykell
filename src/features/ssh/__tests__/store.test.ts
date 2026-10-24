import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listSshConnections,
  saveSshConnection,
  deleteSshConnection,
  touchSshConnection,
  type SshConnection,
} from '@features/ssh/services/api';
import { ensureSshLoaded, useSshStore } from '@features/ssh/stores/store';

vi.mock('@features/ssh/services/api', () => ({
  listSshConnections: vi.fn(),
  saveSshConnection: vi.fn(),
  deleteSshConnection: vi.fn(),
  touchSshConnection: vi.fn(),
}));

const connection: SshConnection = {
  id: 'ssh-1',
  name: '生产机',
  host: 'prod.example.com',
  user: 'root',
  authMethod: 'key',
};

describe('ssh store', () => {
  it('persists manual connection order and reapplies it after loading', async () => {
    const other = { ...connection, id: 'other', name: 'Other' };
    useSshStore.setState({ connections: [connection, other] });
    useSshStore.getState().reorder(0, 1);
    expect(useSshStore.getState().connections.map(item => item.id)).toEqual(['other', 'ssh-1']);
    expect(JSON.parse(localStorage.getItem('vrykell-ssh-order')!)).toEqual(['other', 'ssh-1']);
    vi.mocked(listSshConnections).mockResolvedValueOnce([connection, other]);
    await useSshStore.getState().load();
    expect(useSshStore.getState().connections.map(item => item.id)).toEqual(['other', 'ssh-1']);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSshStore.setState({
      connections: [],
      loaded: false,
      loading: false,
    });
  });

  it('加载连接并更新状态', async () => {
    vi.mocked(listSshConnections).mockResolvedValue([connection]);

    await useSshStore.getState().load();

    expect(useSshStore.getState()).toMatchObject({
      connections: [connection],
      loaded: true,
      loading: false,
    });
  });

  it('加载失败时降级为空列表并结束 loading', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(listSshConnections).mockRejectedValue(new Error('backend down'));

    await useSshStore.getState().load();

    expect(useSshStore.getState()).toMatchObject({
      connections: [],
      loaded: true,
      loading: false,
    });
  });

  it('reapplies saved manual order without changing backend connection data', async () => {
    const backup: SshConnection = { ...connection, id: 'ssh-2', name: '备用机' };
    localStorage.setItem('vrykell-ssh-order', JSON.stringify(['ssh-2']));
    vi.mocked(listSshConnections).mockResolvedValue([connection, backup]);

    await useSshStore.getState().load();

    expect(useSshStore.getState().connections.map((c) => c.id)).toEqual(['ssh-2', 'ssh-1']);
  });

  it('save/remove/touch 调用后端后重新加载', async () => {
    vi.mocked(listSshConnections).mockResolvedValue([]);

    await useSshStore.getState().save(connection);
    await useSshStore.getState().remove(connection.id);
    await useSshStore.getState().touch(connection.id);

    expect(saveSshConnection).toHaveBeenCalledWith(connection);
    expect(deleteSshConnection).toHaveBeenCalledWith(connection.id);
    expect(touchSshConnection).toHaveBeenCalledWith(connection.id);
    expect(listSshConnections).toHaveBeenCalledTimes(3);
  });

  it('ensureSshLoaded 仅触发一次加载', async () => {
    let resolveLoad: (connections: SshConnection[]) => void = () => {};
    vi.mocked(listSshConnections).mockImplementation(
      () => new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    ensureSshLoaded();
    ensureSshLoaded();

    expect(listSshConnections).toHaveBeenCalledTimes(1);
    resolveLoad([connection]);
    await vi.waitFor(() => expect(useSshStore.getState().loaded).toBe(true));
  });
});
