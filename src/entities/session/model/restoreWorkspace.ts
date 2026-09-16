import { listSessions } from '@/api/session';
import type { BackendSessionEntry } from '@features/search/types';
import * as sessionManager from '@/lib/sessionManager';
import { isSessionTab, serializeSession, useWorkspaceStore } from '@/store/workspace';

export interface WorkspaceSession {
  id: string;
  title: string;
  groupId?: string;
  sortOrder: number;
  status: string;
}

export interface PersistableSession {
  id: string;
  title: string;
  kind: string;
  payload: string;
}

export interface RestoreWorkspaceDependencies {
  listSessions: () => Promise<WorkspaceSession[]>;
  loadGroups: () => Promise<void>;
  restoreSession: (session: WorkspaceSession) => Promise<void>;
  hasTabs: () => boolean;
  createDefaultSession: () => PersistableSession | null;
  persistSession: (session: PersistableSession) => void | Promise<void>;
  onError?: (message: string, error: unknown) => void;
}

function defaultErrorHandler(message: string, error: unknown): void {
  console.warn(`[session] ${message}:`, error);
}

/**
 * 会话恢复规则：按持久化顺序恢复 active 会话；无可用标签时创建默认会话。
 * 通过依赖注入隔离 Zustand、IPC 和持久化实现，便于测试和后续替换存储层。
 */
export async function restoreWorkspaceWithDependencies(
  dependencies: RestoreWorkspaceDependencies,
): Promise<void> {
  const onError = dependencies.onError ?? defaultErrorHandler;
  const sessions = await dependencies.listSessions().catch((error: unknown) => {
    onError('读取会话列表失败', error);
    return [];
  });
  const activeSessions = sessions
    .filter((session) => session.status === 'active')
    .sort((left, right) => left.sortOrder - right.sortOrder);

  if (activeSessions.length > 0) {
    await dependencies.loadGroups().catch((error: unknown) => {
      onError('加载会话分组失败，将继续恢复会话', error);
    });
    for (const session of activeSessions) {
      await dependencies.restoreSession(session).catch((error: unknown) => {
        onError(`恢复会话失败：${session.id}`, error);
      });
    }
  }

  if (dependencies.hasTabs()) return;
  const defaultSession = dependencies.createDefaultSession();
  if (!defaultSession) return;

  await Promise.resolve(dependencies.persistSession(defaultSession)).catch((error: unknown) => {
    onError(`持久化默认会话失败：${defaultSession.id}`, error);
  });
}

function toWorkspaceSession(session: BackendSessionEntry): WorkspaceSession {
  return {
    id: session.id,
    title: session.title,
    groupId: session.group_id ?? undefined,
    sortOrder: session.sort_order,
    status: session.status,
  };
}

function createDefaultSession(): PersistableSession | null {
  const workspace = useWorkspaceStore.getState();
  if (workspace.tabs.length !== 0) return null;

  const id = workspace.addTab({});
  const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === id);
  if (!tab || !isSessionTab(tab)) return null;

  const serialized = serializeSession(tab);
  return serialized
    ? { id: tab.id, title: tab.title, kind: serialized.kind, payload: serialized.payload }
    : null;
}

/** 默认生产适配器：连接现有 IPC、Store 和 sessionManager。 */
export function restoreWorkspace(): Promise<void> {
  return restoreWorkspaceWithDependencies({
    listSessions: async () => {
      const sessions = await listSessions();
      return sessions.map(toWorkspaceSession);
    },
    loadGroups: () => useWorkspaceStore.getState().loadGroups(),
    restoreSession: (session) => sessionManager.restore(session.id, session.title, { groupId: session.groupId }),
    hasTabs: () => useWorkspaceStore.getState().tabs.length !== 0,
    createDefaultSession,
    persistSession: (session) => sessionManager.create(session.id, session.title, undefined, session.kind, session.payload),
  });
}
