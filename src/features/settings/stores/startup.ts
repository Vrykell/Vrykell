import { create } from 'zustand';
import { t } from '@i18n';

export type StartupMode = 'restore' | 'default' | 'empty';
export const STARTUP_STORAGE_KEY = 'vrykell-startup-mode';

function loadMode(): StartupMode {
  try {
    // Older builds offered extra startup targets; they all mean "do not restore".
    const saved = localStorage.getItem(STARTUP_STORAGE_KEY);
    return saved === null || saved === 'restore' ? 'restore' : 'empty';
  } catch { return 'restore'; }
}

export const useStartupSettings = create<{
  mode: StartupMode;
  setMode: (mode: StartupMode) => void;
}>((set) => ({
  mode: loadMode(),
  setMode: (mode) => {
    set({ mode });
    try { localStorage.setItem(STARTUP_STORAGE_KEY, mode); }
    catch { throw new Error(t('Browser storage is unavailable; the startup setting was not saved.')); }
  },
}));
