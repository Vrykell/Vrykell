import { create } from 'zustand';
import { gitComparisonKey, type GitSelection } from '@core/git';
import { useSessionStore } from '@features/workspace';

export const useGitReview = create<{
  revision: number;
  open: (selection: GitSelection) => void;
  close: () => void;
  refresh: () => void;
}>((set) => ({
  revision: 0,
  open: selection => { useSessionStore.getState().openGitDiff(selection); },
  close: () => {
    const state = useSessionStore.getState();
    const tab = state.tabs.find(tab => tab.id === state.activeId);
    if (tab?.kind === 'git-diff') {
      const comparison = tab.comparisons?.find(item => gitComparisonKey(item.selection) === gitComparisonKey(tab.selection));
      state.closeGitComparison(comparison?.id ?? tab.id);
    }
  },
  refresh: () => set(state => ({ revision: state.revision + 1 })),
}));

export function useGitSelection() {
  return useSessionStore(state => {
    const tab = state.tabs.find(value => value.id === state.activeId);
    return tab?.kind === 'git-diff' ? tab.selection : null;
  });
}
