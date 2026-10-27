import { create } from 'zustand';

/** Global search highlight — while the user types in the search bar, matching text on the terminal page is highlighted live */
interface SearchHighlightState {
  query: string;
  setQuery: (q: string) => void;
}

export const useSearchHighlightStore = create<SearchHighlightState>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));
