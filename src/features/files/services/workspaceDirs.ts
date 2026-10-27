import { create } from 'zustand';
import { listWorkspaces, addWorkspace, removeWorkspace } from '@platform/api/workspace';

export interface WorkspaceDir {
  id: number;
  path: string;
  name: string;
}

interface WorkspaceDirsState {
  dirs: WorkspaceDir[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (path: string, name: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  contains: (path: string) => boolean;
}

export const useWorkspaceDirsStore = create<WorkspaceDirsState>((set, get) => ({
  dirs: [],
  loaded: false,

  load: async () => {
    try {
      const entries = await listWorkspaces();
      set({
        dirs: entries.map((e) => ({ id: e.id, path: e.path, name: e.name })),
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  add: async (path: string, name: string) => {
    try {
      await addWorkspace(path, name, Date.now());
      // Reload to obtain the server-generated id
      await get().load();
    } catch (e) {
      console.warn('workspaceDirs.add failed:', e);
    }
  },

  remove: async (id: number) => {
    try {
      await removeWorkspace(id);
      set((s) => ({ dirs: s.dirs.filter((d) => d.id !== id) }));
    } catch (e) {
      console.warn('workspaceDirs.remove failed:', e);
    }
  },

  contains: (path: string) => get().dirs.some((d) => d.path === path),
}));
