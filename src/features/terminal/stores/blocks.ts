import { create } from 'zustand';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
import { useToastStore } from '@/components/Toast';
import { t } from '@/i18n';
import * as sessionManager from '@/lib/sessionManager';

const EMPTY: TermBlock[] = [];

interface BlockState {
  /** tabId → 命令块列表 */
  byTab: Record<string, TermBlock[]>;
  addBlock: (tabId: string, block: TermBlock) => void;
  updateBlock: (tabId: string, blockId: string, patch: Partial<TermBlock>) => void;
  setBlocks: (tabId: string, blocks: TermBlock[]) => void;
  clearBlocks: (tabId: string) => void;
  /** 关 tab 时删除该 tab 的 block 数据，避免 per-tab 残留 */
  dropTab: (tabId: string) => void;
  toggleBookmark: (tabId: string, blockId: string) => void;
  /** 单个 block 折叠/展开（持久化） */
  setBlockCollapsed: (tabId: string, blockId: string, collapsed: boolean) => void;
  /** 全部 block 折叠/展开（持久化） */
  setAllCollapsed: (tabId: string, collapsed: boolean) => void;
  jumpToNextBookmark: (tabId: string) => string | null;
  jumpToPrevBookmark: (tabId: string) => string | null;
}

export const useBlockStore = create<BlockState>((set, get) => ({
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

  toggleBookmark: (tabId, blockId) => {
    const blocks = get().byTab[tabId];
    if (!blocks) return;
    const found = blocks.find((b) => b.id === blockId);
    const newState = !found?.bookmarked;
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: (s.byTab[tabId] ?? []).map((b) => (b.id === blockId ? { ...b, bookmarked: newState } : b)),
      },
    }));
    // 副作用（toast）放在 set 外，避免 StrictMode 下更新函数重复执行导致重复提示
    useToastStore.getState().addToast(newState ? t('toast.bookmarked') : t('toast.unbookmarked'), 'success');
  },

  setBlockCollapsed: (tabId, blockId, collapsed) => {
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: (s.byTab[tabId] ?? []).map((b) =>
          b.id === blockId ? { ...b, collapsed: collapsed || undefined } : b,
        ),
      },
    }));
    sessionManager.persistBlockCollapsed(blockId, collapsed);
  },

  setAllCollapsed: (tabId, collapsed) => {
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: (s.byTab[tabId] ?? []).map((b) => ({ ...b, collapsed: collapsed || undefined })),
      },
    }));
    const blocks = get().byTab[tabId] ?? [];
    for (const b of blocks) {
      sessionManager.persistBlockCollapsed(b.id, collapsed);
    }
  },

  jumpToNextBookmark: (tabId) => {
    const blocks = get().byTab[tabId];
    if (!blocks?.length) return null;
    const bm = blocks.filter((b) => b.bookmarked);
    return bm.length > 0 ? bm[0]!.id : null;
  },

  jumpToPrevBookmark: (tabId) => {
    const blocks = get().byTab[tabId];
    if (!blocks?.length) return null;
    const bm = blocks.filter((b) => b.bookmarked);
    return bm.length > 0 ? bm[bm.length - 1]!.id : null;
  },
}));

/** 根据 tabId 获取块的 selector（始终返回稳定引用避免无限渲染）。 */
export function selectBlocks(tabId: string) {
  return (s: BlockState) => s.byTab[tabId] ?? EMPTY;
}
