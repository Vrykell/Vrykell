import { useEffect } from 'react';
import TopDock from './components/TopDock';
import SidePanel from './components/SidePanel';
import StatusBar from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import ToastContainer from './components/Toast';
import GlobalSearch from './search/GlobalSearch';
import TerminalView from './terminal/TerminalView';
import NewTabModal from './components/NewTabModal';
import { setDefaultStream } from './stores/chat';
import { refreshAiConfig } from './lib/ai';
import { agentStream } from './agent/agentStream';
import { initAutoTitle } from './agent/title';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useUiStore } from './stores/ui';
import { useWorkspaceDirsStore } from './files/workspaceDirs';
import { useHistoryStore } from './stores/history';
import { useWorkspaceStore, serializeSession, isSessionTab } from './stores/workspace';
import { minTerminalWidth, MIN_PANE_SIZE, type TerminalSpec } from './lib/windowLayout';
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
  useEffect(() => setDefaultStream(agentStream), []);
  useEffect(() => { refreshAiConfig(); }, []);
  // M7 智能标题：订阅块/对话活动，内容足够时生成概括性标题
  useEffect(() => initAutoTitle(), []);
  useEffect(() => {
    const ws = useWorkspaceStore.getState();
    const initialTab = ws.tabs[0];
    if (initialTab) {
      const ser = serializeSession(initialTab);
      if (ser) sessionManager.create(initialTab.id, initialTab.title, undefined, ser.kind, ser.payload);
    }
  }, []);
  useEffect(() => { useWorkspaceDirsStore.getState().load(); }, []);
  // 命令历史热缓存注水：补全与上下键翻历史在重启后立即有料
  useEffect(() => { void useHistoryStore.getState().hydrate(); }, []);
  useGlobalShortcuts();
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const globalSearchOpen = useUiStore((s) => s.globalSearchOpen);
  const setGlobalSearchOpen = useUiStore((s) => s.setGlobalSearchOpen);
  const splitPickerOpen = useUiStore((s) => s.splitPickerOpen);
  const closeSplitPicker = useUiStore((s) => s.closeSplitPicker);
  // 终端区域最小宽度按布局动态计算：单终端就窄，多终端并排才宽
  const terminalMinWidth = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return tab && isSessionTab(tab) ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
  });

  const handleSplitPick = (spec: TerminalSpec) => {
    closeSplitPicker();
    // 选完类型后进入落点选择（在哪分裂）
    useUiStore.getState().beginSplit(spec);
  };

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
        <div style={{ flex: 1, minWidth: terminalMinWidth, display: 'flex', flexDirection: 'column' }}>
          <TerminalView />
        </div>
        <SidePanel side="right" />
      </div>
      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
      <NewTabModal open={splitPickerOpen} onClose={closeSplitPicker} onPick={handleSplitPick} />
      <ToastContainer />
    </div>
  );
}
