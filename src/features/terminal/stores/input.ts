import { create } from 'zustand';

/**
 * useInputStore — 输入栏每 pane 独立状态（text + AI/命令模式）。
 *
 * 分屏后两个 pane 是独立终端，各自记住草稿与模式；未分屏时 paneId = 标签 id。
 * 聚焦切换（点击 pane / 切标签）由 InputEditor 按聚焦 pane 读取对应状态。
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

/** paneId 的输入状态 selector（缺失时返回稳定 EMPTY，避免无限重渲染）。 */
export function selectPaneInput(paneId: string) {
  return (s: InputState): PaneInput => s.byPane[paneId] ?? EMPTY;
}
