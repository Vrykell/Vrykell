import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SHELL_TYPES, type ShellOption, type ShellType } from '@platform/shells';

export type DefaultShell = ShellType | 'system';

/** Resolve a saved preference against this machine's installed shells. */
export function preferredShell(preference: DefaultShell, shells: ShellOption[]): ShellType | undefined {
  return (shells.find(shell => shell.id === preference) ?? shells.find(shell => shell.default) ?? shells[0])?.id;
}

export const useTerminalDefaults = create<{
  shell: DefaultShell;
  setShell: (shell: DefaultShell) => void;
}>()(
  persist(set => ({ shell: 'system', setShell: shell => set({ shell }) }), {
    name: 'vrykell-terminal-defaults',
    merge: (saved, current) => {
      const shell = (saved as { shell?: unknown } | null)?.shell;
      return { ...current, shell: typeof shell === 'string' && SHELL_TYPES.includes(shell as ShellType) ? shell as ShellType : 'system' };
    },
  }),
);
