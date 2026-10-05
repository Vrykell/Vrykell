import { applyCachedWallpaper, useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { applyTheme } from '@config/theme/tokens';
import { installGlobalErrorHandlers } from '@utils/errorHandler';
import { initializeDiagnostics } from '@platform/diagnostics';

/** 在 React 挂载前完成不会依赖 React 树的启动工作，减少首屏闪烁。 */
export function preloadApplication(): void {
  initializeDiagnostics();
  applyTheme((document.documentElement.dataset.theme as 'dark' | 'light') || 'dark');
  applyCachedWallpaper();
  void useTerminalThemeStore.getState().load();
  installGlobalErrorHandlers();
}
