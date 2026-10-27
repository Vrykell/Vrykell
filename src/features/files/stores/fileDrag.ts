import { create } from 'zustand';

/** Entry being dragged (icon for the preview + path for later operations). */
export interface FileDragItem {
  path: string;
  name: string;
  is_dir: boolean;
}

/** Drop target: the hit row (for highlighting) and the directory it represents (for the drop). */
export interface FileDropTarget {
  rowPath: string | null;
  dir: string;
}

export interface FileDragState {
  items: FileDragItem[];
  /** Pointer position (the preview follows it) */
  pointer: { x: number; y: number } | null;
  /** Currently hovered drop target */
  target: FileDropTarget | null;
  start: (items: FileDragItem[], pointer: { x: number; y: number }) => void;
  movePointer: (pointer: { x: number; y: number }) => void;
  hover: (target: FileDropTarget | null) => void;
  end: () => void;
}

/** File panel drag state: dropping a row on a folder, a file (its parent directory) or the breadcrumb moves it. */
export const useFileDragStore = create<FileDragState>((set) => ({
  items: [],
  pointer: null,
  target: null,
  start: (items, pointer) => set({ items, pointer, target: null }),
  movePointer: (pointer) => set({ pointer }),
  hover: (target) => set({ target }),
  end: () => set({ items: [], pointer: null, target: null }),
}));
