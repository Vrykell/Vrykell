/** 工作区领域公开入口。 */
export { useUiStore } from '@features/workspace/stores/ui';
export {
  useDockStore,
  PANEL_DEFS,
  MIN_PANEL_WIDTH,
  useChatPanelOpen,
  type DockSide,
} from '@features/workspace/stores/dock';
export { useDockDragStore } from '@features/workspace/stores/dockDrag';
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
} from '@features/workspace/model/session/store';
export {
  restoreWorkspace,
  restoreWorkspaceWithDependencies,
  type PersistableSession,
  type RestoreWorkspaceDependencies,
  type WorkspaceSession,
} from '@features/workspace/model/session/restoreWorkspace';
export {
  selectActiveSessionTab,
  selectSessionTabs,
  type SessionWorkspaceSnapshot,
} from '@features/workspace/model/session/selectors';
export {
  MIN_PANE_SIZE,
  countLeaves,
  firstLeaf,
  leaf,
  leaves,
  minTerminalWidth,
  splitLeaf,
  type TerminalSpec,
  type WindowLayout,
} from '@features/workspace/model/windowLayout';
export {
  buildNewTabOptions,
  filterNewTabOptions,
  loadRecentOpen,
  saveRecentOpen,
  touchRecentOpen,
  type NewTabOption,
} from '@features/workspace/model/tabTypes';
export { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
