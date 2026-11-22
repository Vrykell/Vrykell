import { useEffect, useRef, useState } from 'react';
import { iconSizes, Search, PanelLeft, ArrowLeft, ArrowRight } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useUiStore, useWorkspaceNavigation } from '@features/workspace';
import { WORKSPACE_AREA_LABELS } from '../stores/navigation';
import DockNavigation from './DockNavigation';
import WindowControls from '@features/workspace/components/WindowControls';
import WindowMenu from './WindowMenu';
import { isMacOS } from '@platform/runtime';
import { t } from '@i18n';
import { WorkspaceHeaderSlot } from '@ui/layout/WorkspaceHeader';
import { goBackWorkspaceArea, goForwardWorkspaceArea } from '../services/areaHistory';

/** One row owns the window chrome, the active tab strip and the global actions. */
export default function TopDock({ sidebarOverlayRequired = false }: { sidebarOverlayRequired?: boolean }) {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const area = useWorkspaceNavigation((state) => state.area);
  const collapsed = useWorkspaceNavigation((state) => state.collapsed);
  const canGoBack = useWorkspaceNavigation((state) => state.areaHistoryIndex > 0);
  const canGoForward = useWorkspaceNavigation((state) => state.areaHistoryIndex < state.areaHistory.length - 1);
  const workspaceTitle = t(WORKSPACE_AREA_LABELS[area]);
  const [fullscreen, setFullscreen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const searchShortcut = isMacOS ? 'Meta+F' : 'Control+F';
  const tabbedArea = area === 'terminal' || area === 'code' || area === 'ai' || area === 'unified';

  useEffect(() => {
    if (!isMacOS) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWindow();
      const sync = async () => {
        const value = await win.isFullscreen();
        if (!disposed) setFullscreen(value);
      };
      void sync().catch(() => {});
      void win
        .onResized(() => {
          void sync().catch(() => {});
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      /* Browser previews have no native window. */
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    // Every non-interactive part of the titlebar is a window drag handle; buttons
    // below keep their own behaviour because a clickable element without the
    // attribute blocks dragging for the whole path.
    <header
      ref={headerRef}
      className="workspace-titlebar"
      data-platform={isMacOS ? 'macos' : 'other'}
      data-fullscreen={fullscreen}
      data-sidebar-collapsed={collapsed}
      data-tauri-drag-region>
      <div data-tauri-drag-region className="workspace-title">
        {collapsed && (
          <IconButton
            compact
            className="workspace-sidebar-toggle"
            data-testid="workspace-sidebar-expand"
            aria-label={t('Expand sidebar')}
            data-tip={t('Expand sidebar')}
            onClick={() => useWorkspaceNavigation.getState().openSidebar(sidebarOverlayRequired)}>
            <PanelLeft size={iconSizes.control} />
          </IconButton>
        )}
        {(collapsed || settingsOpen) && <span data-tauri-drag-region>{settingsOpen ? t('Settings') : workspaceTitle}</span>}
        {(canGoBack || canGoForward) && (
          <div className="workspace-title-history">
            <IconButton
              compact
              data-testid="workspace-history-back"
              aria-label={t('Back')}
              data-tip={t('Back')}
              disabled={!canGoBack}
              onClick={goBackWorkspaceArea}>
              <ArrowLeft size={iconSizes.control} />
            </IconButton>
            <IconButton
              compact
              data-testid="workspace-history-forward"
              aria-label={t('Forward')}
              data-tip={t('Forward')}
              disabled={!canGoForward}
              onClick={goForwardWorkspaceArea}>
              <ArrowRight size={iconSizes.control} />
            </IconButton>
          </div>
        )}
      </div>
      <WorkspaceHeaderSlot visible={!settingsOpen && tabbedArea} />
      <span className="workspace-title-divider" aria-hidden="true" />
      <IconButton
        compact
        data-testid="global-search-trigger"
        aria-label={t('Search files, commands, settings…')}
        data-tip={`${t('Search files, commands, settings…')} (${searchShortcut})`}
        onClick={() => useUiStore.getState().setGlobalSearchOpen(true)}>
        <Search size={iconSizes.control} />
      </IconButton>
      <div className="workspace-title-actions">
        <DockNavigation side="right" />
        <WindowControls />
      </div>
      <WindowMenu titlebar={headerRef} />
    </header>
  );
}
