import { create } from 'zustand';

/**
 * useDockDragStore — 拖动终端调整位置的全局状态。
 * 拖动某个终端（把手）时写入 draggingTerminalId，TerminalView 据此渲染落点覆盖层；
 * 松手/取消时清除。具体悬停落点由 MoveDragLayer 内部状态维护。
 */

interface DockDragState {
  draggingTerminalId: string | null;

  start: (terminalId: string) => void;
  end: () => void;
}

export const useDockDragStore = create<DockDragState>((set) => ({
  draggingTerminalId: null,

  start: (terminalId) => set({ draggingTerminalId: terminalId }),
  end: () => set({ draggingTerminalId: null }),
}));
