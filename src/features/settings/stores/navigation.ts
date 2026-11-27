import { create } from 'zustand';
import { useTerminalDefaults } from '@config/terminalDefaults';
import { isMacOS, isWindows } from '@platform/runtime';
import type { ShellType } from '@platform/shells';
import type { PageId, SettingsDestination } from '../model/navigation';

const preferredProfile = useTerminalDefaults.getState().shell;

/** Retain the destination across mounting and external settings navigation. */
export const useSettingsNavigationStore = create<{
  selected: PageId;
  shellProfile: ShellType;
  targetField: string | null;
  request: number;
  targetControl?: string;
  openField: (destination: SettingsDestination, title: string, control?: string) => void;
  openShellProfile: (shell: ShellType) => void;
  setSelected: (page: PageId) => void;
}>((set) => ({
  selected: 'ai-model',
  targetField: null,
  request: 0,
  shellProfile: preferredProfile === 'system' ? (isWindows ? 'powershell' : isMacOS ? 'zsh' : 'bash') : preferredProfile,
  setSelected: (selected) => set({ selected, targetField: null, targetControl: undefined }),
  openShellProfile: (shellProfile) => set({ selected: 'shell-profiles', shellProfile, targetField: null, targetControl: undefined }),
  openField: (destination, targetField, targetControl) =>
    set((state) => ({
      ...(typeof destination === 'string' ? { selected: destination } : { selected: destination.page, shellProfile: destination.shell }),
      targetField,
      targetControl,
      request: state.request + 1,
    })),
}));
