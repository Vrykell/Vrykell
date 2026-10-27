import { create } from 'zustand';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

const EMPTY: TermBlock[] = [];

interface BlockState {
  /** tabId → command block list */
  byTab: Record<string, TermBlock[]>;
  addBlock: (tabId: string, block: TermBlock) => void;
  updateBlock: (tabId: string, blockId: string, patch: Partial<TermBlock>) => void;
  setBlocks: (tabId: string, blocks: TermBlock[]) => void;
  clearBlocks: (tabId: string) => void;
  /** Remove the tab's block data when it closes, leaving no per-tab residue */
  dropTab: (tabId: string) => void;
}

export const useBlockStore = create<BlockState>((set) => ({
  byTab: {},

  addBlock: (tabId, block) =>
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: [...(s.byTab[tabId] ?? []), block] },
    })),

  updateBlock: (tabId, blockId, patch) =>
    set((s) => {
      const blocks = s.byTab[tabId];
      if (!blocks) return s;
      return {
        byTab: { ...s.byTab, [tabId]: blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) },
      };
    }),

  setBlocks: (tabId, blocks) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: blocks } })),

  clearBlocks: (tabId) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: [] } })),

  dropTab: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const byTab = { ...s.byTab };
      delete byTab[tabId];
      return { byTab };
    }),
}));

/** Block selector for a tab (always returns a stable reference to prevent render loops). */
export function selectBlocks(tabId: string) {
  return (s: BlockState) => s.byTab[tabId] ?? EMPTY;
}
