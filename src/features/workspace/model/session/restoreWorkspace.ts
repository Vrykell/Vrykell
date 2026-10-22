import { archiveSession, listSessions } from '@platform/api/session';
import type { BackendSessionEntry } from '@platform/api/types';
import * as sessionManager from '@features/workspace/services/sessionManager';
import { isSessionTab, isStartTab, serializeSession, useWorkspaceStore } from '@features/workspace/stores/workspace';
import { useStartupSettings, type StartupMode } from '@features/settings/stores/startup';

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
  launchDirectory?: string | null;
  openDirectory?: (cwd: string) => void;
  startupMode?: StartupMode;
  archiveSession?: (sessionId: string) => Promise<void>;
  listSessions: () => Promise<WorkspaceSession[]>;
  loadGroups: () => Promise<void>;
  restoreSession: (session: WorkspaceSession) => Promise<void>;
  hasTabs: () => boolean;
  createDefaultSession: () => PersistableSession | null;
  persistSession?: (session: PersistableSession) => void | Promise<void>;
  onError?: (message: string, error: unknown) => void;
}

function defaultErrorHandler(message: string, error: unknown): void {
  console.warn(`[session] ${message}:`, error);
}

/** Restore saved sessions or create a fresh workspace according to startup preferences. */
export async function restoreWorkspaceWithDependencies(
  dependencies: RestoreWorkspaceDependencies,
): Promise<void> {
  const onError = dependencies.onError ?? defaultErrorHandler;
  if (dependencies.launchDirectory && dependencies.openDirectory) {
    if (!dependencies.hasTabs()) dependencies.openDirectory(dependencies.launchDirectory);
    return;
  }
  const mode = dependencies.startupMode ?? 'restore';
  if (mode !== 'restore' && dependencies.archiveSession) {
    const saved = await dependencies.listSessions().catch((error: unknown) => {
      onError('整理上次的会话记录失败', error);
      return [];
    });
    for (const session of saved.filter((item) => item.status === 'active')) {
      await dependencies.archiveSession(session.id).catch((error: unknown) => onError(`归档上次的会话失败：${session.id}`, error));
    }
  }
  if (mode === 'empty') return;
  if (mode === 'default') {
    if (dependencies.hasTabs()) return;
    const session = dependencies.createDefaultSession();
    if (session && dependencies.persistSession) await Promise.resolve(dependencies.persistSession(session)).catch((error: unknown) => {
      onError(`持久化默认会话失败：${session.id}`, error);
    });
    return;
  }
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

  if (!dependencies.persistSession) return;
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
  if (workspace.tabs.some(tab => !isStartTab(tab))) return null;

  const id = workspace.addTab({});
  const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === id);
  if (!tab || !isSessionTab(tab)) return null;

  const serialized = serializeSession(tab);
  return serialized
    ? { id: tab.id, title: tab.title, kind: serialized.kind, payload: serialized.payload }
    : null;
}

/** 默认生产适配器：连接现有 IPC、Store 和 sessionManager。 */
export function restoreWorkspace(
  options: { onError?: (message: string, error: unknown) => void; launchDirectory?: string | null } = {},
): Promise<void> {
  return restoreWorkspaceWithDependencies({
    onError: options.onError,
    launchDirectory: options.launchDirectory,
    openDirectory: cwd => { useWorkspaceStore.getState().addTab({ cwd }); },
    startupMode: useStartupSettings.getState().mode,
    archiveSession: (id) => archiveSession(id, Date.now()),
    listSessions: async () => {
      const sessions = await listSessions();
      return sessions.map(toWorkspaceSession);
    },
    loadGroups: () => useWorkspaceStore.getState().loadGroups(),
    restoreSession: (session) => sessionManager.restore(session.id, session.title),
    hasTabs: () => useWorkspaceStore.getState().tabs.some(tab => !isStartTab(tab)),
    createDefaultSession,
  });
}
