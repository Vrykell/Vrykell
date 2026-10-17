import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CommandRunTarget = 'new' | 'current';
export type CommandDoubleClick = 'insert' | 'run';
interface CommandHistorySettings {
  runIn: CommandRunTarget;
  doubleClick: CommandDoubleClick;
  migrated: boolean;
  update: (value: Partial<Pick<CommandHistorySettings, 'runIn' | 'doubleClick'>>) => void;
  migrate: (legacy?: CommandRunTarget) => void;
}

/** Panel behavior is application-wide; project preferences only hold library data. */
export const useCommandHistorySettings = create<CommandHistorySettings>()(persist((set, get) => ({
  runIn: 'new', doubleClick: 'insert', migrated: false,
  update: value => set({ ...value, migrated: true }),
  migrate: legacy => { if (!get().migrated) set({ runIn: legacy === 'current' ? 'current' : 'new', migrated: true }); },
}), {
  name: 'vrykell-command-history-settings',
  merge: (saved, current) => {
    const value = saved as Partial<CommandHistorySettings> | null;
    return { ...current, runIn: value?.runIn === 'current' ? 'current' : 'new', doubleClick: value?.doubleClick === 'run' ? 'run' : 'insert', migrated: value?.migrated === true };
  },
}));
