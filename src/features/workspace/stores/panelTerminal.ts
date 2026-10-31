import { create } from 'zustand';

/** Panels that can follow one terminal independently of the focused pane. */
export type PanelTerminalPanel = 'files' | 'command-history' | 'git';

export interface PanelTerminalBinding {
  paneId: string;
  tabId: string;
  kind: 'local' | 'ssh';
  connectionId?: string;
}

interface PanelTerminalState {
  bindings: Partial<Record<PanelTerminalPanel, PanelTerminalBinding>>;
  bind: (panel: PanelTerminalPanel, binding: PanelTerminalBinding) => void;
  clear: (panel: PanelTerminalPanel) => void;
}

/** Session-scoped bindings; a closed or replaced pane falls back to the focused terminal. */
export const usePanelTerminalStore = create<PanelTerminalState>(set => ({
  bindings: {},
  bind: (panel, binding) => set(state => ({ bindings: { ...state.bindings, [panel]: binding } })),
  clear: panel => set(state => {
    if (!state.bindings[panel]) return state;
    const bindings = { ...state.bindings };
    delete bindings[panel];
    return { bindings };
  }),
}));
