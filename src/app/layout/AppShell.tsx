import { useCallback } from 'react';
import { useUiStore } from '@features/workspace';
import { useTerminalThemeStore } from '@features/settings/model/terminalTheme';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';
import WorkspaceShell from '@app/layout/WorkspaceShell';
import ApplicationOverlays from '@app/layout/ApplicationOverlays';

/** 应用视觉壳：背景、内容层、工作区与应用级弹层。 */
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
          backgroundColor: 'var(--canvas)',
          backgroundImage: wallpaperDataUrl ? `url("${wallpaperDataUrl}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--canvas)',
          color: 'var(--text-primary)',
          opacity: effectiveOpacity,
        }}
      >
        <WorkspaceShell />
        <ApplicationOverlays onPickSplit={handleSplitPick} />
      </div>
    </>
  );
}
