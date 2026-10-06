import { useEffect, useRef, useState } from 'react';
import { iconSizes, Search } from '@ui/icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionStore, useUiStore } from '@features/workspace';
import DockNavigation from './DockNavigation';
import WindowControls from '@features/workspace/components/WindowControls';
import { isMacOS } from '@platform/runtime';
import { useBalancedTitlebar } from '../hooks/useBalancedTitlebar';

/** Keep window controls and global actions separate from workspace navigation. */
export default function TopDock() {
  const activeTab = useSessionStore(s => s.tabs.find(tab => tab.id === s.activeId));
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
    <header ref={headerRef} className="workspace-titlebar">
      <div data-tauri-drag-region className="workspace-title" style={{ paddingLeft: isMacOS && !fullscreen ? 86 : 20 }}>
        <span>{activeTab?.title || '终端工作区'}</span>
      </div>
      <button data-subtle data-testid="global-search-trigger" className="workspace-search"
        onClick={() => useUiStore.getState().setGlobalSearchOpen(true)}>
        <Search size={iconSizes.control} />
        <span>搜索文件、命令、设置…</span>
        <kbd>{isMacOS ? '⌘ F' : 'Ctrl F'}</kbd>
      </button>
      <div ref={actionsRef} className="workspace-title-actions">
        <DockNavigation side="right" />
        <WindowControls />
      </div>
    </header>
  );
}
