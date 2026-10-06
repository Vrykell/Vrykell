import { create } from 'zustand';

export interface FileDragState {
  /** 正在拖动的条目路径 */
  paths: string[];
  /** 指针位置（预览跟随） */
  pointer: { x: number; y: number } | null;
  /** 当前悬停的放置目标（文件夹路径） */
  overPath: string | null;
  /** 按住 Alt：复制而不是移动 */
  copy: boolean;
  start: (paths: string[], pointer: { x: number; y: number }) => void;
  movePointer: (pointer: { x: number; y: number }) => void;
  hover: (overPath: string | null) => void;
  setCopy: (copy: boolean) => void;
  end: () => void;
}

/** 文件面板拖拽状态：行拖到文件夹移动/复制（指针事件，避开桌面窗口的原生拖放）。 */
export const useFileDragStore = create<FileDragState>((set) => ({
  paths: [],
  pointer: null,
  overPath: null,
  copy: false,
  start: (paths, pointer) => set({ paths, pointer, overPath: null, copy: false }),
  movePointer: (pointer) => set({ pointer }),
  hover: (overPath) => set({ overPath }),
  setCopy: (copy) => set({ copy }),
  end: () => set({ paths: [], pointer: null, overPath: null, copy: false }),
}));
