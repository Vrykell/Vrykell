/** 工作区领域公开入口。 */
export { useUiStore } from '@features/workspace/stores/ui';
export {
  useDockStore,
  PANEL_DEFS,
  NAVIGATION_DEFS,
  MIN_PANEL_WIDTH,
  type DockSide,
} from '@features/workspace/stores/dock';
export { useDockDragStore } from '@features/workspace/stores/dockDrag';
export { useNavigationDrag } from '@features/workspace/stores/navigationDrag';
export { useNavigationButtonDrag } from '@features/workspace/hooks/useNavigationButtonDrag';
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
  type TitleSource,
} from '@features/workspace/model/session/store';
export {
  restoreWorkspace,
  restoreWorkspaceWithDependencies,
  type PersistableSession,
  type RestoreWorkspaceDependencies,
  type WorkspaceSession,
} from '@features/workspace/model/session/restoreWorkspace';
export { initForwardedLaunch } from '@features/workspace/services/forwardedLaunch';
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
export { useTabDisplayTitle } from '@features/workspace/hooks/useTabDisplayTitle';
export { tabIconKey, tabIconColor } from './model/tabAppearance';
export { useWorkspaceNavigation, orderedWorkspaceIds, workspaceAreaForKind } from './stores/navigation';
