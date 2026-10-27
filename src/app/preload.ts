import { applyCachedWallpaper, useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import { applyTheme, readThemePreference, resolveThemeMode } from '@config/theme/tokens';
import { installGlobalErrorHandlers } from '@utils/errorHandler';
import { initializeDiagnostics } from '@platform/diagnostics';
import { syncWindowFrame } from '@platform/windowChrome';

/** Startup work that does not depend on the component tree, done before mount to avoid first-paint flicker. */
export function preloadApplication(): void {
  initializeDiagnostics();
  applyTheme(resolveThemeMode(readThemePreference()));
  syncWindowFrame();
  applyCachedWallpaper();
  void useTerminalThemeStore.getState().load();
  installGlobalErrorHandlers();
}
