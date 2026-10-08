import { create } from 'zustand';
import type { DockSide } from './dock';

export interface NavigationDropTarget { side: DockSide; index: number; openPanel?: boolean; }

interface NavigationDrag {
  id: string | null;
  target: NavigationDropTarget | null;
  position: { x: number; y: number } | null;
  start: (id: string, position?: { x: number; y: number }) => void;
  movePointer: (x: number, y: number) => void;
  hover: (side: DockSide, index: number, openPanel?: boolean) => void;
  end: () => void;
}

/** Transient shared drag state lets both navigation areas accept the same action. */
export const useNavigationDrag = create<NavigationDrag>(set => ({
  id: null,
  target: null,
  position: null,
  start: (id, position) => set({ id, target: null, position: position ?? null }),
  movePointer: (x, y) => set({ position: { x, y } }),
  hover: (side, index, openPanel) => set(state => state.target?.side === side && state.target.index === index && !!state.target.openPanel === !!openPanel ? state : { target: { side, index, ...(openPanel ? { openPanel } : {}) } }),
  end: () => set({ id: null, target: null, position: null }),
}));
