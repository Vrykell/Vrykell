/** Public entry point for the workspace domain. */
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
  loadRecentOpen,
  saveRecentOpen,
  touchRecentOpen,
  type NewTabOption,
} from '@features/workspace/model/tabTypes';
export { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
export { useCanRemoveWorkspacePane } from './hooks/useCanRemoveWorkspacePane';
export { useScopedPaneActive } from './hooks/useScopedPaneActive';
export { usePlacedWorkspaceResourceIds } from './hooks/usePlacedWorkspaceResourceIds';
export { default as ScopedPaneWorkspace } from './components/ScopedPaneWorkspace';
export { useTabDisplayTitle } from '@features/workspace/hooks/useTabDisplayTitle';
export { default as WorkspaceResourceSwitcher } from './components/WorkspaceResourceSwitcher';
export { default as WorkspaceSplitAction } from './components/WorkspaceSplitAction';
export { detachCompositionPane, useUnifiedWorkspace } from './stores/unifiedWorkspace';
export { useWorkspaceNavigation, orderedWorkspaceIds, workspaceAreaForKind, type HistoryTypePreset } from './stores/navigation';
