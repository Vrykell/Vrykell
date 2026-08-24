import { useCallback, type FC } from 'react';
import { useDockStore, type DockSide, PANEL_DEFS } from '../stores/dock';
import { useWorkspaceStore, isSessionTab } from '../stores/workspace';
import ResizeHandle from './ResizeHandle';
import PanelTabs from './PanelTabs';
import PanelFiles from '../files/PanelFiles';
import PanelSsh from '../ssh/PanelSsh';
import PanelChat from '../chat/PanelChat';

interface SidePanelProps {
  side: DockSide;
}

const PANEL_COMPONENTS: Record<string, FC> = {
  tabs: PanelTabs,
  files: PanelFiles,
  ssh: PanelSsh,
  chat: PanelChat,
};

export default function SidePanel({ side }: SidePanelProps) {
  const leftPanels = useDockStore((s) => s.leftPanels);
  const rightPanels = useDockStore((s) => s.rightPanels);
  // AI 面板与终端强相关：当前激活标签不是会话（设置/历史）时隐藏，切回会话自动恢复
  const isSessionActive = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return !!tab && isSessionTab(tab);
  });

  const panelIds = side === 'left' ? leftPanels : rightPanels;
  if (panelIds.length === 0) return null;

  return (
    <>
      {panelIds.map((panelId) => {
        if (panelId === 'chat' && !isSessionActive) return null;
        return <SinglePanel key={panelId} side={side} panelId={panelId} />;
      })}
    </>
  );
}

function SinglePanel({ side, panelId }: { side: DockSide; panelId: string }) {
  const setPanelWidth = useDockStore((s) => s.setPanelWidth);
  const panelWidths = useDockStore((s) => s.panelWidths);
  const isLeft = side === 'left';

  const def = PANEL_DEFS[panelId];
  const PanelContent = def ? PANEL_COMPONENTS[panelId] : null;
  const width = panelWidths[panelId] || def?.width || 200;

  const handleDelta = useCallback((d: number) => {
    // 传增量给 store，由 store 用当前值累加（避免渲染闭包陈旧丢增量）
    setPanelWidth(panelId, isLeft ? d : -d);
  }, [panelId, isLeft, setPanelWidth]);

  if (!def || !PanelContent) return null;

  return (
    <div style={{
      position: 'relative',
      flexShrink: 0,
      minHeight: 0,
      ...(isLeft
        ? { borderRight: '1px solid var(--border)' }
        : { borderLeft: '1px solid var(--border)' }),
    }}>
      <div style={{
        width,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        background: 'var(--surface)',
      }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <PanelContent />
        </div>
      </div>

      {/* 拖拽手柄 — 绝对定位覆盖在内边缘，无可见缝隙 */}
      <ResizeHandle axis="x" edge={isLeft ? 'right' : 'left'} onDelta={handleDelta} />
    </div>
  );
}
