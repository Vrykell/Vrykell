import { useEffect } from 'react';
import TopDock from './components/TopDock';
import SidePanel from './components/SidePanel';
import StatusBar from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import ToastContainer from './components/Toast';
import GlobalSearch from './search/GlobalSearch';
import TerminalView from './terminal/TerminalView';
import { setDefaultStream } from './stores/chat';
import { anthropicStream, refreshAiConfig } from './lib/ai';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useUiStore } from './stores/ui';
import { useWorkspaceDirsStore } from './files/workspaceDirs';
import { useWorkspaceStore } from './stores/workspace';
import { useTerminalLayoutStore } from './stores/terminalLayout';
import * as sessionManager from './lib/sessionManager';
import './search/init'; // 触发所有搜索源自动注册

/**
 * App 布局（Dock 功能区系统）：
 *   App (100vh, flex column)
 *   ├── TopDock (28px 全宽顶栏，左右功能区 + 可拖拽按钮)
 *   ├── flex row
 *   │   ├── SidePanel (left)  — 左侧面板，由 Dock 按钮控制
 *   │   ├── TerminalView      — 终端主区域
 *   │   └── SidePanel (right) — 右侧面板，由 Dock 按钮控制
 *   ├── StatusBar
 *   ├── CommandPalette (overlay)
 *   └── ToastContainer (overlay)
 *
 * TopDock 左侧 78px 为 macOS 红绿灯保留空间。
 */
export default function App() {
  useEffect(() => setDefaultStream(anthropicStream), []);
  useEffect(() => { refreshAiConfig(); }, []);
  useEffect(() => {
    const ws = useWorkspaceStore.getState();
    const initialTab = ws.tabs[0];
    if (initialTab) sessionManager.create(initialTab.id, initialTab.title);
    // 停靠布局：剔除重启后已不存在的 tab id，再保证初始标签有槽位显示
    const layout = useTerminalLayoutStore.getState();
    const validIds = new Set(ws.tabs.filter((t) => t.kind === 'local' || t.kind === 'ssh').map((t) => t.id));
    layout.reconcile(validIds);
    if (useTerminalLayoutStore.getState().slots.every((s) => s === null) && initialTab) {
      useTerminalLayoutStore.getState().dockTab(initialTab.id, 0);
    }
  }, []);
  useEffect(() => { useWorkspaceDirsStore.getState().load(); }, []);
  useGlobalShortcuts();
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const globalSearchOpen = useUiStore((s) => s.globalSearchOpen);
  const setGlobalSearchOpen = useUiStore((s) => s.setGlobalSearchOpen);

  return (
    <div style={{
      height: '100vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--canvas)',
      color: 'var(--text-primary)',
    }}>
      <TopDock />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        <SidePanel side="left" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TerminalView />
        </div>
        <SidePanel side="right" />
      </div>
      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
      <ToastContainer />
    </div>
  );
}
