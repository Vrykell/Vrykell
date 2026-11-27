import { useEffect, useRef, useState } from 'react';
import { iconSizes, Search, PanelLeft } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import { TextButton } from '@ui/actions/TextButton';
import { WorkspaceHeaderSlot } from '@ui/layout/WorkspaceHeader';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useUiStore, useWorkspaceNavigation } from '@features/workspace';
import { WORKSPACE_AREA_LABELS } from '../stores/navigation';
import DockNavigation from './DockNavigation';
import WindowControls from '@features/workspace/components/WindowControls';
import WindowMenu from './WindowMenu';
import { isMacOS } from '@platform/runtime';
import { t } from '@i18n';

/** Keep window controls and global actions separate from workspace navigation. */
export default function TopDock({
  sidebarOverlayRequired = false,
  showTabs = false,
}: {
  sidebarOverlayRequired?: boolean;
  showTabs?: boolean;
}) {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const area = useWorkspaceNavigation((state) => state.area);
  const collapsed = useWorkspaceNavigation((state) => state.collapsed);
  const workspaceTitle = t(WORKSPACE_AREA_LABELS[area]);
  const [fullscreen, setFullscreen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

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
    <header
      ref={headerRef}
      className="workspace-titlebar"
      data-platform={isMacOS ? 'macos' : 'other'}
      data-fullscreen={fullscreen}
      data-sidebar-collapsed={collapsed}
      data-has-tabs={showTabs || undefined}
      data-reorder-frame
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
        {!showTabs && <span data-tauri-drag-region>{settingsOpen ? t('Settings') : workspaceTitle}</span>}
      </div>
      <WorkspaceHeaderSlot visible={showTabs} />
      <div className="workspace-title-drag" data-reorder-clearance data-tauri-drag-region />
      <div className="workspace-title-actions">
        <TextButton
          className="workspace-global-search"
          data-testid="global-search-trigger"
          aria-label={t('Global search')}
          aria-haspopup="dialog"
          data-tip={t('Global search')}
          data-tip-shortcut={isMacOS ? 'Meta+F' : 'Control+F'}
          onClick={() => useUiStore.getState().setGlobalSearchOpen(true)}>
          <Search size={iconSizes.control} />
          <span>{t('Global search')}</span>
        </TextButton>
        <DockNavigation side="right" />
        <WindowControls />
      </div>
      <WindowMenu titlebar={headerRef} />
    </header>
  );
}
