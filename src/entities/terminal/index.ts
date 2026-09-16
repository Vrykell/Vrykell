/**
 * 终端实体公开入口。
 *
 * 终端状态暂时仍由既有 Zustand Store 实现，业务模块只依赖这个入口，
 * 后续可以在不改动调用方的情况下替换底层状态实现。
 */
export {
  useTerminalStore,
  termInstances,
  registerTerminal,
  unregisterTerminal,
  getFocusedTerminalId,
  getRecentOutput,
  getRecentOutputFor,
  getTerminalScreen,
  type TerminalScreen,
} from '@/store/terminal';

export {
  useBlockStore,
  selectBlocks,
} from '@/store/blocks';

export {
  useInputStore,
  selectPaneInput,
  type PaneInput,
} from '@/store/input';
