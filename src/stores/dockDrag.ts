import { create } from 'zustand';

/**
 * useDockDragStore — 标签页拖拽到终端区域的全局拖拽状态。
 *
 * PanelTabs 的标签拖拽开始时写入 draggingTabId + cursor；TerminalView 据此渲染
 * 4 象限预停靠高亮，并在 mousemove 时把 hoveredSlot 写回；PanelTabs 的 mouseup
 * 读取 hoveredSlot 决定「停靠」还是「侧栏内重排」。
 */

interface DockDragState {
  draggingTabId: string | null;
  cursor: { x: number; y: number } | null;
  /** 当前悬停的槽位（0..3），null = 不在终端区域 */
  hoveredSlot: number | null;

  start: (tabId: string, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  setHoveredSlot: (slot: number | null) => void;
  end: () => void;
}

export const useDockDragStore = create<DockDragState>((set) => ({
  draggingTabId: null,
  cursor: null,
  hoveredSlot: null,

  start: (tabId, x, y) => set({ draggingTabId: tabId, cursor: { x, y }, hoveredSlot: null }),
  move: (x, y) => set({ cursor: { x, y } }),
  setHoveredSlot: (slot) => set({ hoveredSlot: slot }),
  end: () => set({ draggingTabId: null, cursor: null, hoveredSlot: null }),
}));
