import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GitTarget } from '@core/git';

interface RepositoryContext { target: GitTarget; paneId: string }
interface GitContextState {
  recent: RepositoryContext | null;
  sourceKey: string;
  remember: (sourceKey: string, context: RepositoryContext) => void;
  select: (context: RepositoryContext) => void;
  canonicalize: (sourceKey: string, root: string) => void;
}
export const useGitContextStore = create<GitContextState>()(persist((set, get) => ({
  recent: null, sourceKey: '',
  remember: (sourceKey, recent) => { if (get().sourceKey !== sourceKey) set({ sourceKey, recent }); },
  select: recent => set({ recent }),
  canonicalize: (sourceKey, root) => {
    const state = get();
    if (state.sourceKey === sourceKey && state.recent && state.recent.target.cwd !== root)
      set({ recent: { ...state.recent, target: { ...state.recent.target, cwd: root } } });
  },
}), {
  name: 'vrykell-git-context', partialize: state => ({ recent: state.recent }),
  merge: (saved, current) => {
    const recent = (saved as { recent?: RepositoryContext } | null)?.recent;
    return { ...current, recent: recent && typeof recent.paneId === 'string' && typeof recent.target?.cwd === 'string'
      && (recent.target.connectionId === undefined || typeof recent.target.connectionId === 'string') ? recent : null };
  },
}));
