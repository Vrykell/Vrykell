import { create } from 'zustand';

/** 正在拖动的条目（预览用图标 + 后续操作用路径）。 */
export interface FileDragItem {
  path: string;
  name: string;
  is_dir: boolean;
}

/** 放置目标：命中的行（用于高亮）与它代表的目录（用于落地）。 */
export interface FileDropTarget {
  rowPath: string | null;
  dir: string;
}

export interface FileDragState {
  /** 正在拖动的条目 */
  items: FileDragItem[];
  /** 指针位置（预览跟随） */
  pointer: { x: number; y: number } | null;
  /** 当前悬停的放置目标 */
  target: FileDropTarget | null;
  start: (items: FileDragItem[], pointer: { x: number; y: number }) => void;
  movePointer: (pointer: { x: number; y: number }) => void;
  hover: (target: FileDropTarget | null) => void;
  end: () => void;
}

/** 文件面板拖拽状态：行拖到文件夹/文件（同级目录）/面包屑即移动。 */
export const useFileDragStore = create<FileDragState>((set) => ({
  items: [],
  pointer: null,
  target: null,
  start: (items, pointer) => set({ items, pointer, target: null }),
  movePointer: (pointer) => set({ pointer }),
  hover: (target) => set({ target }),
  end: () => set({ items: [], pointer: null, target: null }),
}));
