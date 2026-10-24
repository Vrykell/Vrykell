import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Local panel directory memory, independent of navigation history.
 *
 * The local tree unmounts when the focused session swaps to an SSH tree or
 * through the download manager, and a remount would re-initialize it from the
 * focused terminal's cwd. Remembering the browsed directory here keeps the
 * view instead, mirroring the per-connection store of the remote panel.
 */
interface LocalPathState {
  /** An empty memory uses the terminal directory; a null path restores the drive view. */
  remembered: { path: string | null } | null;
  remember: (path: string | null) => void;
}

export const useLocalPathStore = create<LocalPathState>()(persist((set) => ({
  remembered: null,
  remember: (path) => set({ remembered: { path } }),
}), {
  name: 'vrykell-files-location',
  partialize: state => ({ remembered: state.remembered }),
  merge: (saved, current) => {
    const remembered = (saved as Partial<LocalPathState> | null)?.remembered;
    return { ...current, remembered: remembered && (remembered.path === null || typeof remembered.path === 'string' && remembered.path.length > 0)
      ? { path: remembered.path } : null };
  },
}));
