/**
 * Theme provider — manages the appearance preference (dark / light / follow system)
 * through component context. Components read the applied mode and the preference via useTheme().
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  readThemePreference, resolveThemeMode, persistThemePreference,
  type ThemeMode, type ThemePreference,
} from '@config/theme/tokens';
import { applyTerminalTheme, useTerminalThemeStore } from '@features/settings/model/terminalTheme';

interface ThemeCtx {
  /** Palette mode currently applied (a 'system' preference is resolved). */
  mode: ThemeMode;
  /** Stored choice: 'dark', 'light' or 'system'. */
  preference: ThemePreference;
  toggle: () => void;
  setMode: (preference: ThemePreference) => void;
}

const Ctx = createContext<ThemeCtx>({
  mode: 'dark',
  preference: 'dark',
  toggle: () => {},
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());
  const [mode, setModeState] = useState<ThemeMode>(() => resolveThemeMode(readThemePreference()));

  // Follow the operating system while the preference is 'system'.
  useEffect(() => {
    const sync = () => setModeState(resolveThemeMode(preference));
    sync();
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [preference]);

  useEffect(() => {
    // On a mode change, re-apply the base palette, the background-layer opacity and the terminal theme
    applyTerminalTheme(useTerminalThemeStore.getState().config, mode);
  }, [mode]);

  const apply = useCallback((next: ThemePreference) => {
    persistThemePreference(next);
    setPreference(next);
  }, []);

  const toggle = useCallback(() => {
    apply(resolveThemeMode(preference) === 'dark' ? 'light' : 'dark');
  }, [apply, preference]);

  const setMode = useCallback((next: ThemePreference) => apply(next), [apply]);

  return <Ctx.Provider value={{ mode, preference, toggle, setMode }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
