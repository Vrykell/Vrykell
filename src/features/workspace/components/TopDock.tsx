import { useEffect, useState } from 'react';
import { Search, Settings, Sparkles } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDockStore, useSessionStore, useUiStore, selectActiveSessionTab } from '@features/workspace';
import WindowControls from '@features/workspace/components/WindowControls';
import { isMacOS } from '@platform/runtime';

/** Keep window controls and global actions separate from workspace navigation. */
export default function TopDock() {
  const activeTab = useSessionStore(s => s.tabs.find(tab => tab.id === s.activeId));
  const isSession = useSessionStore(s => selectActiveSessionTab(s) !== null);
  const chatOpen = useDockStore(s => s.leftPanels.includes('chat') || s.rightPanels.includes('chat'));
  const [fullscreen, setFullscreen] = useState(false);

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
    <header className="workspace-titlebar">
      <div data-tauri-drag-region className="workspace-title" style={{ paddingLeft: isMacOS && !fullscreen ? 86 : 20 }}>
        <span>{activeTab?.title || '终端工作区'}</span>
      </div>
      <button data-subtle data-testid="global-search-trigger" className="workspace-search"
        onClick={() => useUiStore.getState().setGlobalSearchOpen(true)}>
        <Search size={14} />
        <span>搜索文件、命令、设置…</span>
        <kbd>{isMacOS ? '⌘ F' : 'Ctrl F'}</kbd>
      </button>
      <div data-tauri-drag-region className="workspace-title-spacer" />
      {isSession && (
        <button data-subtle data-dock-btn="chat" className="workspace-ai-toggle" aria-pressed={chatOpen}
          title={chatOpen ? '关闭 AI 助手' : '打开 AI 助手'}
          onClick={() => {
            const dock = useDockStore.getState();
            dock.togglePanel('right', 'chat');
          }}>
          <Sparkles size={15} /><span>AI 助手</span>
        </button>
      )}
      <button data-subtle className="workspace-settings" aria-label="设置" title={`设置（${isMacOS ? '⌘' : 'Ctrl'}+,）`}
        onClick={() => useSessionStore.getState().openSettingsTab()}><Settings size={16} /></button>
      <WindowControls />
    </header>
  );
}
