import { create } from 'zustand';

export type StartupMode = 'restore' | 'default' | 'empty';
export const STARTUP_STORAGE_KEY = 'vrykell-startup-mode';

function loadMode(): StartupMode {
  try {
    const saved = localStorage.getItem(STARTUP_STORAGE_KEY);
    return saved === 'default' || saved === 'empty' ? saved : 'restore';
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
    catch { throw new Error('浏览器存储不可用，启动设置未能保存'); }
  },
}));
