/** 终端领域公开入口。 */
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
} from '@features/terminal/stores/terminal';

export {
  useBlockStore,
  selectBlocks,
} from '@features/terminal/stores/blocks';

export {
  useInputStore,
  selectPaneInput,
  type PaneInput,
} from '@features/terminal/stores/input';

export { useHistoryStore } from '@features/terminal/stores/history';
