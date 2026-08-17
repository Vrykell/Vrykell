import { create } from 'zustand';

/** 全局搜索高亮 — 当用户在搜索栏输入时，终端页面上的匹配文字实时高亮 */
interface SearchHighlightState {
  query: string;
  setQuery: (q: string) => void;
}

export const useSearchHighlightStore = create<SearchHighlightState>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));
