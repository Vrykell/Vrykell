import { isMacOS } from '@platform/runtime';
import { useCallback } from 'react';
import { useUiStore } from '@features/workspace';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';
import WorkspaceShell from '@app/layout/WorkspaceShell';
import ApplicationOverlays from '@app/layout/ApplicationOverlays';
import OverlayScrollbars from '@ui/OverlayScrollbars';

/** Paint the window surface, workspace, and application overlays. */
export default function AppShell() {
  const wallpaperDataUrl = useTerminalThemeStore((state) => state.wallpaperDataUrl);
  const appOpacity = useTerminalThemeStore((state) => state.config.opacity);
  const effectiveOpacity = wallpaperDataUrl ? appOpacity : 1;

  const handleSplitPick = useCallback((spec: TerminalSpec) => {
    useUiStore.getState().closeSplitPicker();
    useUiStore.getState().beginSplit(spec);
  }, []);

  return (
    <>
      <div
        aria-hidden
        data-testid="wallpaper-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          backgroundColor: 'var(--chrome-bg)',
          backgroundImage: wallpaperDataUrl ? `url("${wallpaperDataUrl}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        className="application-window"
        data-platform={isMacOS ? 'macos' : 'other'}
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--chrome-bg)',
          color: 'var(--text-primary)',
          opacity: effectiveOpacity,
        }}
      >
        <WorkspaceShell />
        <ApplicationOverlays onPickSplit={handleSplitPick} />
        <OverlayScrollbars />
      </div>
    </>
  );
}
