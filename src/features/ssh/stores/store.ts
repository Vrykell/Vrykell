import { create } from 'zustand';
import {
  listSshConnections,
  saveSshConnection,
  deleteSshConnection,
  touchSshConnection,
  type SshConnection,
} from '@features/ssh/services/api';
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';
import { clearSshAuthenticationMetadata } from './sessionAuthentication';

const ORDER_KEY = 'vrykell-ssh-order';

/** Manual drag order is a frontend preference; connections carry no sort field. */
function applySavedOrder(connections: SshConnection[]): SshConnection[] {
  const parsed = safeJsonParse<unknown>(safeLocalStorageGet(ORDER_KEY) ?? '');
  if (!Array.isArray(parsed)) return connections;
  const rank = new Map(
    parsed.filter((id): id is string => typeof id === 'string').map((id, index) => [id, index]),
  );
  if (rank.size === 0) return connections;
  // Unknown ids stay after the known ones, in backend order (sort is stable).
  return [...connections].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

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
  /** Move one connection to a new index and persist the manual order. */
  reorder: (from: number, to: number) => void;
}

export const useSshStore = create<SshState>((set, get) => ({
  connections: [],
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const connections = applySavedOrder(await listSshConnections());
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

  reorder: (from, to) => {
    const connections = [...get().connections];
    if (from < 0 || from >= connections.length) return;
    const [moved] = connections.splice(from, 1);
    connections.splice(Math.max(0, Math.min(to, connections.length)), 0, moved!);
    set({ connections });
    safeLocalStorageSet(ORDER_KEY, JSON.stringify(connections.map((connection) => connection.id)));
  },
}));

/** 确保 store 已从后端加载（幂等，fire-and-forget）。 */
export function ensureSshLoaded(): void {
  const s = useSshStore.getState();
  if (!s.loaded && !s.loading) void s.load();
}
