import { applyCachedWallpaper, useTerminalThemeStore } from '@/theme/terminalTheme';
import { applyTheme } from '@/theme/tokens';
import { installGlobalErrorHandlers } from '@/lib/errorHandler';

/** 在 React 挂载前完成不会依赖 React 树的启动工作，减少首屏闪烁。 */
export function preloadApplication(): void {
  applyTheme((document.documentElement.dataset.theme as 'dark' | 'light') || 'dark');
  applyCachedWallpaper();
  void useTerminalThemeStore.getState().load();
  installGlobalErrorHandlers();
}
