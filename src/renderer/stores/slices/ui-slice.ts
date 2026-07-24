import { StateCreator } from 'zustand';

export interface UISlice {
  sidebarOpen: boolean;
  outputPanelOpen: boolean;
  outputPanelHeight: number;
  toggleSidebar: () => void;
  toggleOutputPanel: () => void;
  setOutputPanelHeight: (h: number) => void;
}

export const createUISlice: StateCreator<UISlice> = (set) => ({
  sidebarOpen: false,
  outputPanelOpen: false,
  outputPanelHeight: 200,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleOutputPanel: () => set((s) => ({ outputPanelOpen: !s.outputPanelOpen })),
  setOutputPanelHeight: (h) => set({ outputPanelHeight: h }),
});
