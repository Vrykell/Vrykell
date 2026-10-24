import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SHELL_TYPES, type ShellType } from '@platform/shells';

export interface ShellProfile { name: string; cwd: string; tabTitle: string; hidden: boolean }
export const EMPTY_SHELL_PROFILE: ShellProfile = { name: '', cwd: '', tabTitle: '', hidden: false };

export const useShellProfiles = create<{
  profiles: Partial<Record<ShellType, ShellProfile>>;
  update: (shell: ShellType, patch: Partial<ShellProfile>) => void;
}>()(persist(set => ({
  profiles: {},
  update: (shell, patch) => set(state => ({ profiles: { ...state.profiles, [shell]: { ...EMPTY_SHELL_PROFILE, ...state.profiles[shell], ...patch } } })),
}), {
  name: 'vrykell-shell-profiles',
  partialize: state => ({ profiles: state.profiles }),
  merge: (saved, current) => {
    const source = (saved as { profiles?: Partial<Record<ShellType, Partial<ShellProfile>>> } | null)?.profiles;
    const profiles: Partial<Record<ShellType, ShellProfile>> = {};
    for (const shell of SHELL_TYPES) {
      const entry = source?.[shell];
      if (entry && typeof entry === 'object') profiles[shell] = {
        name: typeof entry.name === 'string' ? entry.name : '', cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
        tabTitle: typeof entry.tabTitle === 'string' ? entry.tabTitle : '', hidden: entry.hidden === true,
      };
    }
    return { ...current, profiles };
  },
}));
