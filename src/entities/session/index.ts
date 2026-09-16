export {
  restoreWorkspace,
  restoreWorkspaceWithDependencies,
  type PersistableSession,
  type RestoreWorkspaceDependencies,
  type WorkspaceSession,
} from '@/entities/session/model/restoreWorkspace';
export {
  useSessionStore,
  firstTerminalOf,
  getFocusedCwd,
  isSessionTab,
  nextTerminalId,
  serializeSession,
  terminalsOf,
  type AddTabOptions,
  type SshTabTarget,
  type Tab,
  type TabGroup,
} from '@/entities/session/model/store';
export { selectActiveSessionTab, selectSessionTabs, type SessionWorkspaceSnapshot } from '@/entities/session/model/selectors';
