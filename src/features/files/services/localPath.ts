import { create } from 'zustand';

/**
 * Local panel directory memory (session only).
 *
 * The local tree unmounts when the focused session swaps to an SSH tree or
 * through the download manager, and a remount would re-initialize it from the
 * focused terminal's cwd. Remembering the browsed directory here keeps the
 * view instead, mirroring the per-connection store of the remote panel.
 */
interface LocalPathState {
  /** null = nothing browsed this session; an object = the remembered location (`path` null = the drive view). */
  remembered: { path: string | null } | null;
  remember: (path: string | null) => void;
}

export const useLocalPathStore = create<LocalPathState>((set) => ({
  remembered: null,
  remember: (path) => set({ remembered: { path } }),
}));
