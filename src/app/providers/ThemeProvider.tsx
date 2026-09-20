/**
 * 主题 Provider — 通过 React Context 管理 dark/light 切换。
 * 所有组件通过 useTheme() 获取当前模式和切换函数。
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { getCurrentTheme, type ThemeMode } from '@config/theme/tokens';
import { applyTerminalTheme, useTerminalThemeStore } from '@features/settings/model/terminalTheme';

interface ThemeCtx {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({
  mode: 'dark',
  toggle: () => {},
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => getCurrentTheme());

  useEffect(() => {
    // 明暗切换：重应用基础 palette + 背景层不透明度 + xterm 主题
    applyTerminalTheme(useTerminalThemeStore.getState().config, mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setModeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
  }, []);

  return <Ctx.Provider value={{ mode, toggle, setMode }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
