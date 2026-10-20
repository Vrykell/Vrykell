import { isMacOS, isWindows } from '@platform/runtime';
import { useCallback, useEffect } from 'react';
import { useUiStore } from '@features/workspace';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';
import WorkspaceShell from '@app/layout/WorkspaceShell';
import ApplicationOverlays from '@app/layout/ApplicationOverlays';
import OverlayScrollbars from '@ui/OverlayScrollbars';
import { useTheme } from '@app/providers/ThemeProvider';
import { syncWindowMaterial } from '@platform/windowChrome';

/** Paint the window surface, workspace, and application overlays. */
export default function AppShell() {
  const wallpaperDataUrl = useTerminalThemeStore((state) => state.wallpaperDataUrl);
  const appOpacity = useTerminalThemeStore((state) => state.config.opacity);
  const desktopTint = useTerminalThemeStore(state => state.config.desktopTint ?? true);
  const { mode } = useTheme();
  const effectiveOpacity = wallpaperDataUrl ? appOpacity : 1;
  useEffect(() => { void syncWindowMaterial(desktopTint, mode); }, [desktopTint, mode]);

  const handleSplitPick = useCallback((spec: TerminalSpec) => {
    useUiStore.getState().closeSplitPicker();
    useUiStore.getState().beginSplit(spec);
  }, []);

  // Surfaces portaled to the document body sit outside the window element, so the window opacity
  // cannot reach them; publish the applied value for those surfaces to mirror.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--app-opacity', String(effectiveOpacity));
    return () => { root.style.removeProperty('--app-opacity'); };
  }, [effectiveOpacity]);

  return (
    <>
      <div
        aria-hidden
        data-testid="wallpaper-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          backgroundColor: desktopTint ? 'transparent' : 'var(--chrome-bg)',
          backgroundImage: wallpaperDataUrl ? `url("${wallpaperDataUrl}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        className="application-window"
        data-desktop-tint={desktopTint}
        data-wallpaper={wallpaperDataUrl ? 'true' : 'false'}
        data-platform={isMacOS ? 'macos' : isWindows ? 'windows' : 'other'}
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'transparent',
          color: 'var(--text-primary)',
          opacity: effectiveOpacity,
        }}
      >
        <div className="application-chrome" aria-hidden="true" />
        <WorkspaceShell />
        <ApplicationOverlays onPickSplit={handleSplitPick} />
        <OverlayScrollbars />
      </div>
    </>
  );
}
