import { useEffect } from 'react';
import SidePanel from '@/components/layout/SidePanel/SidePanel';
import TopDock from '@/components/layout/TopDock/TopDock';
import CommandPalette from '@/components/ui/CommandPalette/CommandPalette';
import NewTabModal from '@/components/ui/NewTabModal/NewTabModal';
import ToastContainer from '@/components/ui/Toast/Toast';
import { agentStream } from '@/features/agent/services/agentStream';
import { initScheduleRunner } from '@/features/agent/services/scheduleRunner';
import { initAutoTitle } from '@/features/agent/services/title';
import { useWorkspaceDirsStore } from '@/features/files/services/workspaceDirs';
import GlobalSearch from '@/features/search/components/GlobalSearch';
import type { BackendSessionEntry } from '@/features/search/types';
import TerminalView from '@/features/terminal/components/TerminalView';
import { listSessions } from '@/services/api/session';
import { refreshAiConfig } from '@/services/tauri/ai';
import * as sessionManager from '@/services/tauri/sessionManager';
import { MIN_PANE_SIZE, minTerminalWidth, type TerminalSpec } from '@/services/tauri/windowLayout';
import { useTerminalThemeStore } from '@/services/theme/terminalTheme';
import { useGlobalShortcuts } from '@/shared/hooks/useGlobalShortcuts';
import { setDefaultStream } from '@/store/chat';
import { useHistoryStore } from '@/store/history';
import { useUiStore } from '@/store/ui';
import { isSessionTab, serializeSession, useWorkspaceStore } from '@/store/workspace';
import '@/search/init'; // 触发所有搜索源自动注册

/**
 * App 布局（Dock 功能区系统）：
 *   App (100vh, flex column)
 *   ├── TopDock (28px 全宽顶栏，左右功能区 + 可拖拽按钮)
 *   ├── flex row
 *   │   ├── SidePanel (left)  — 左侧面板，由 Dock 按钮控制
 *   │   ├── TerminalView      — 终端主区域
 *   │   └── SidePanel (right) — 右侧面板，由 Dock 按钮控制
 *   ├── CommandPalette (overlay)
 *   └── ToastContainer (overlay)
 *
 * TopDock 左侧 78px 为 macOS 红绿灯保留空间。
 */
export default function App() {
  useEffect(() => setDefaultStream(agentStream), []);
  useEffect(() => {
    refreshAiConfig();
  }, []);
  // M7 智能标题：订阅块/对话活动，内容足够时生成概括性标题
  useEffect(() => initAutoTitle(), []);
  // 定时任务调度：应用运行期间按间隔触发（曾只活在设置页里，平时不执行）
  useEffect(() => initScheduleRunner(), []);
  // 启动会话恢复：优先恢复上次仍处于活跃（未关闭）的会话标签页；
  // 仅当没有可恢复的会话时才创建默认终端（避免默认终端与恢复逻辑竞态）。
  useEffect(() => {
    void (async () => {
      const sessions = await listSessions().catch(() => [] as BackendSessionEntry[]);
      const active = sessions
        .filter((s) => s.status === 'active')
        .sort((a, b) => a.sort_order - b.sort_order);

      if (active.length > 0) {
        // 有可恢复会话：先恢复分组结构（保持组归属与折叠态），再逐个恢复
        await useWorkspaceStore.getState().loadGroups();
        for (const s of active) {
          await sessionManager
            .restore(s.id, s.title, { groupId: s.group_id ?? undefined })
            .catch((e) => console.warn('App restore session failed:', s.id, e));
        }
      }

      // 无待恢复会话（或全部恢复失败）→ 创建默认终端并持久化为会话记录
      const ws = useWorkspaceStore.getState();
      if (ws.tabs.length === 0) {
        const id = ws.addTab({});
        const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === id);
        if (tab) {
          const ser = serializeSession(tab);
          if (ser) sessionManager.create(tab.id, tab.title, undefined, ser.kind, ser.payload);
        }
      }
    })();
  }, []);
  useEffect(() => {
    useWorkspaceDirsStore.getState().load();
  }, []);
  // 命令历史热缓存注水：补全与上下键翻历史在重启后立即有料
  useEffect(() => {
    void useHistoryStore.getState().hydrate();
  }, []);
  useGlobalShortcuts();
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const globalSearchOpen = useUiStore((s) => s.globalSearchOpen);
  const setGlobalSearchOpen = useUiStore((s) => s.setGlobalSearchOpen);
  const splitPickerOpen = useUiStore((s) => s.splitPickerOpen);
  const closeSplitPicker = useUiStore((s) => s.closeSplitPicker);
  // 终端区域最小宽度按布局动态计算：单终端就窄，多终端并排才宽。
  const terminalMinWidth = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return tab && isSessionTab(tab) ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
  });

  // 终端主题外观：壁纸（data URL）+ 整个应用统一不透明度
  const wallpaperDataUrl = useTerminalThemeStore((s) => s.wallpaperDataUrl);
  const appOpacity = useTerminalThemeStore((s) => s.config.opacity);
  // 没有壁纸时不应用不透明度，避免纯黑兜底上文字亮度急剧下降
  const effectiveOpacity = wallpaperDataUrl ? appOpacity : 1;

  const handleSplitPick = (spec: TerminalSpec) => {
    closeSplitPicker();
    // 选完类型后进入落点选择（在哪分裂）
    useUiStore.getState().beginSplit(spec);
  };

  return (
    <>
      {/* 壁纸背景层：固定铺满整窗，位于内容之下 */}
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
      {/* 应用内容：作为一个整体统一不透明度，透出壁纸背景层 */}
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
        <TopDock />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
          <SidePanel side="left" />
          <div
            style={{
              flex: 1,
              minWidth: terminalMinWidth,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <TerminalView />
          </div>
          <SidePanel side="right" />
        </div>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
        <NewTabModal open={splitPickerOpen} onClose={closeSplitPicker} onPick={handleSplitPick} />
        <ToastContainer />
      </div>
    </>
  );
}
