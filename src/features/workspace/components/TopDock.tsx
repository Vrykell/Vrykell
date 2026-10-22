import KeyHint from '@ui/KeyHint';
import { useEffect, useRef, useState } from 'react';
import { iconSizes, Search, PanelLeft } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionStore, useTabDisplayTitle, useUiStore, useWorkspaceNavigation, workspaceAreaForKind } from '@features/workspace';
import DockNavigation from './DockNavigation';
import WindowControls from '@features/workspace/components/WindowControls';
import { isMacOS } from '@platform/runtime';
import { t } from '@i18n';
import { useBalancedTitlebar } from '../hooks/useBalancedTitlebar';

/** Keep window controls and global actions separate from workspace navigation. */
export default function TopDock({ sidebarOverlayRequired = false }: { sidebarOverlayRequired?: boolean }) {
  const activeTab = useSessionStore(s => s.tabs.find(tab => tab.id === s.activeId));
  const displayTitle = useTabDisplayTitle(activeTab);
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const area = useWorkspaceNavigation(state => state.area);
  const collapsed = useWorkspaceNavigation(state => state.collapsed);
  const workspaceTitle = t(area === 'code' ? 'Code workspace' : area === 'ai' ? 'AI workspace' : area === 'ssh' ? 'SSH hosts' : area === 'history' ? 'All history' : 'Terminal workspace');
  const [fullscreen, setFullscreen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useBalancedTitlebar(headerRef, actionsRef);

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
      void win.onResized(() => { void sync().catch(() => {}); })
        .then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(() => {});
    } catch { /* Browser previews have no native window. */ }
    return () => { disposed = true; unlisten?.(); };
  }, []);

  return (
    // Every non-interactive part of the titlebar is a window drag handle; buttons
    // below keep their own behaviour because a clickable element without the
    // attribute blocks dragging for the whole path.
    <header ref={headerRef} className="workspace-titlebar" data-platform={isMacOS ? 'macos' : 'other'} data-fullscreen={fullscreen} data-sidebar-collapsed={collapsed} data-tauri-drag-region>
      <div data-tauri-drag-region className="workspace-title">
        {collapsed && <IconButton compact className="workspace-sidebar-toggle" data-testid="workspace-sidebar-expand" aria-label={t('Expand sidebar')} data-tip={t('Expand sidebar')}
          onClick={() => useWorkspaceNavigation.getState().openSidebar(sidebarOverlayRequired)}><PanelLeft size={iconSizes.control} /></IconButton>}
        <span data-tauri-drag-region>{settingsOpen ? t('Settings') : activeTab && workspaceAreaForKind(activeTab.kind) === area ? displayTitle : workspaceTitle}</span>
      </div>
      <button data-subtle data-testid="global-search-trigger" className="workspace-search"
        onClick={() => useUiStore.getState().setGlobalSearchOpen(true)}>
        <Search size={iconSizes.control} />
        <span>{t('Search files, commands, settings…')}</span>
        <KeyHint shortcut={isMacOS ? 'Meta+F' : 'Control+F'} />
      </button>
      <div ref={actionsRef} className="workspace-title-actions">
        <DockNavigation side="right" />
        <WindowControls />
      </div>
    </header>
  );
}
