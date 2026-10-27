import { create } from 'zustand';

/**
 * Global state for dragging a terminal to a new position.
 * Dragging a terminal (by its handle) writes draggingTerminalId, which TerminalView uses to
 * render the drop overlay; releasing or cancelling clears it. The hovered drop target itself
 * is held in MoveDragLayer's local state.
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
