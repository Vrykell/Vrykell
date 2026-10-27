/**
 * Domain entry point for session state.
 *
 * Business UI reads through this module so the underlying store implementation can be
 * replaced without changing call sites.
 */
export {
  useWorkspaceStore as useSessionStore,
  isSessionTab,
  firstTerminalOf,
  terminalsOf,
  serializeSession,
  nextTerminalId,
  getFocusedCwd,
} from '@features/workspace/stores/workspace';

export type {
  Tab,
  TabGroup,
  AddTabOptions,
  SshTabTarget,
  TitleSource,
} from '@features/workspace/stores/workspace';
