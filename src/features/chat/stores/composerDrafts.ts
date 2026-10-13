import { create } from 'zustand';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import type { TerminalReference } from '../model/conversation';

export interface ComposerDraft {
  text: string;
  attachments: AttachmentMeta[];
  references?: TerminalReference[];
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: '', attachments: [] };

interface ComposerDraftState {
  byTab: Record<string, ComposerDraft>;
  setText: (tabId: string, text: string) => void;
  updateAttachments: (tabId: string, update: (current: AttachmentMeta[]) => AttachmentMeta[]) => void;
  dropTab: (tabId: string) => void;
  setReferences: (tabId: string, references: TerminalReference[]) => void;
}

// Keep unfinished messages in memory across panel closures and session switches.
export const useComposerDrafts = create<ComposerDraftState>((set) => ({
  byTab: {},
  setReferences: (tabId, references) => set(state => ({
    byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? EMPTY_COMPOSER_DRAFT), references } },
  })),
  setText: (tabId, text) => set((state) => ({
    byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? EMPTY_COMPOSER_DRAFT), text } },
  })),
  updateAttachments: (tabId, update) => set((state) => {
    const draft = state.byTab[tabId] ?? EMPTY_COMPOSER_DRAFT;
    return { byTab: { ...state.byTab, [tabId]: { ...draft, attachments: update(draft.attachments) } } };
  }),
  dropTab: (tabId) => set((state) => {
    const byTab = { ...state.byTab };
    delete byTab[tabId];
    return { byTab };
  }),
}));
