import { create } from 'zustand';
import type { DockSide } from './dock';

interface NavigationDrag {
  id: string | null;
  target: { side: DockSide; index: number } | null;
  position: { x: number; y: number } | null;
  start: (id: string, position?: { x: number; y: number }) => void;
  movePointer: (x: number, y: number) => void;
  hover: (side: DockSide, index: number) => void;
  end: () => void;
}

/** Transient shared drag state lets both navigation areas accept the same action. */
export const useNavigationDrag = create<NavigationDrag>(set => ({
  id: null,
  target: null,
  position: null,
  start: (id, position) => set({ id, target: null, position: position ?? null }),
  movePointer: (x, y) => set({ position: { x, y } }),
  hover: (side, index) => set(state => state.target?.side === side && state.target.index === index ? state : { target: { side, index } }),
  end: () => set({ id: null, target: null, position: null }),
}));
