/**
 * 会话状态的领域入口。
 *
 * 当前实现仍复用旧 Store，避免一次性搬迁终端状态；业务 UI 从这里读取，
 * 后续可以在不修改调用方的情况下替换底层 Zustand 实现。
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
} from '@features/workspace/stores/workspace';
