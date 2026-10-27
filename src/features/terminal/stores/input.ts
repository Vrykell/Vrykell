import { create } from 'zustand';

/**
 * useInputStore — per-pane composer state (text plus AI/command mode).
 *
 * After a split each pane is an independent terminal with its own draft and mode;
 * without a split paneId equals the tab id. Focus switches read the state for the
 * focused pane through InputEditor.
 */

export interface PaneInput {
  text: string;
  aiMode: boolean;
  commandDraft?: string;
  aiDraft?: string;
  focusRequest?: number;
}

interface InputState {
  byPane: Record<string, PaneInput>;
  setText: (paneId: string, text: string) => void;
  setAiMode: (paneId: string, aiMode: boolean) => void;
  stageText: (paneId: string, text: string) => void;
  clearText: (paneId: string) => void;
  dropPane: (paneId: string) => void;
}

const EMPTY: PaneInput = { text: '', aiMode: false };

export const useInputStore = create<InputState>((set) => ({
  byPane: {},

  stageText: (paneId, text) => set(s => {
    const current = s.byPane[paneId] ?? EMPTY;
    const draft = current.aiMode ? current.commandDraft ?? '' : current.text;
    return { byPane: { ...s.byPane, [paneId]: {
      ...current, aiMode: false,
      ...(current.aiMode ? { aiDraft: current.text } : {}),
      text: draft ? `${draft}${draft.endsWith('\n') ? '' : '\n'}${text}` : text,
      focusRequest: (current.focusRequest ?? 0) + 1,
    } } };
  }),

  setText: (paneId, text) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? EMPTY), text } },
    })),

  setAiMode: (paneId, aiMode) =>
    set((s) => {
      const current = s.byPane[paneId] ?? EMPTY;
      if (current.aiMode === aiMode) return s;
      // Keep drafts separate so natural language never becomes a shell command.
      const next = {
        ...current,
        [current.aiMode ? 'aiDraft' : 'commandDraft']: current.text,
        text: (aiMode ? current.aiDraft : current.commandDraft) ?? '',
        aiMode,
      };
      return { byPane: { ...s.byPane, [paneId]: next } };
    }),

  clearText: (paneId) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? EMPTY), text: '' } },
    })),

  dropPane: (paneId) =>
    set((s) => {
      if (!(paneId in s.byPane)) return s;
      const byPane = { ...s.byPane };
      delete byPane[paneId];
      return { byPane };
    }),
}));

/** Input state selector for a pane (returns a stable EMPTY when absent, preventing render loops). */
export function selectPaneInput(paneId: string) {
  return (s: InputState): PaneInput => s.byPane[paneId] ?? EMPTY;
}
