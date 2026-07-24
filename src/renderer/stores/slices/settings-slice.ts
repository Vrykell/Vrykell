import { StateCreator } from 'zustand';
import { AppSettings, DEFAULT_SETTINGS } from '../../../shared/types/index';

export interface SettingsSlice {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
}

export const createSettingsSlice: StateCreator<SettingsSlice> = (set) => ({
  settings: DEFAULT_SETTINGS,

  updateSettings: (partial) =>
    set((s) => ({
      settings: {
        ...s.settings,
        ...partial,
        terminal: { ...s.settings.terminal, ...partial.terminal },
        appearance: { ...s.settings.appearance, ...partial.appearance },
        richContent: { ...s.settings.richContent, ...partial.richContent },
        ai: { ...s.settings.ai, ...partial.ai },
        ssh: { ...s.settings.ssh, ...partial.ssh },
      },
    })),
});
