import { create } from 'zustand';
import {
  listSshConnections,
  saveSshConnection,
  deleteSshConnection,
  touchSshConnection,
  type SshConnection,
} from '@features/ssh/services/api';
import { clearSshAuthenticationMetadata } from './sessionAuthentication';

/**
 * SSH 连接 store —— 后端 SQLite 的响应式投影。
 * 存储与 CRUD 均在后端；前端只缓存列表（密码不回显）。
 */
interface SshState {
  connections: SshConnection[];
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  save: (conn: SshConnection) => Promise<void>;
  remove: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

export const useSshStore = create<SshState>((set, get) => ({
  connections: [],
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const connections = await listSshConnections();
      set({ connections, loaded: true });
    } catch (e) {
      console.warn('ssh.load failed:', e);
      set({ connections: [], loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  save: async (conn) => {
    await saveSshConnection(conn);
    clearSshAuthenticationMetadata(conn.id);
    await get().load();
  },

  remove: async (id) => {
    await deleteSshConnection(id);
    clearSshAuthenticationMetadata(id);
    await get().load();
  },

  touch: async (id) => {
    await touchSshConnection(id);
    await get().load();
  },

}));

/** 确保 store 已从后端加载（幂等，fire-and-forget）。 */
export function ensureSshLoaded(): void {
  const s = useSshStore.getState();
  if (!s.loaded && !s.loading) void s.load();
}
