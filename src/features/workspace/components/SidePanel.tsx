import { useCallback, useEffect, useState, type FC } from 'react';
import { iconSizes, X  } from '@ui/icons';
import { useDockStore, PANEL_DEFS, MIN_PANEL_WIDTH, type DockSide } from '@features/workspace';
import { selectActiveSessionTab, useSessionStore } from '@features/workspace';
import ResizeHandle from '@ui/ResizeHandle';
import PanelTabs from '@features/workspace/components/PanelTabs';
import PanelFiles from '@features/files/components/PanelFiles';
import PanelSsh from '@features/ssh/components/PanelSsh';
import PanelChat from '@features/chat/components/PanelChat';

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
  const isSessionActive = useSessionStore((state) => selectActiveSessionTab(state) !== null);

  const panelIds = side === 'left' ? leftPanels : rightPanels;
  const zone = useDockStore(s => side === 'left' ? s.leftZone : s.rightZone);
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    setVisited(previous => {
      const added = panelIds.filter(id => id !== 'chat' && !previous.includes(id));
      return added.length ? [...previous, ...added] : previous;
    });
  }, [panelIds]);
  const mountedIds = [...new Set([...visited.filter(id => zone.includes(id)), ...panelIds])];

  return (
    <>
      {mountedIds.map((panelId) => {
        if (panelId === 'chat' && !isSessionActive) return null;
        return <SinglePanel key={panelId} side={side} panelId={panelId} visible={panelIds.includes(panelId)} />;
      })}
    </>
  );
}

function SinglePanel({ side, panelId, visible }: { side: DockSide; panelId: string; visible: boolean }) {
  const setPanelWidth = useDockStore((s) => s.setPanelWidth);
  const commitPanelWidth = useDockStore((s) => s.commitPanelWidth);
  const panelWidths = useDockStore((s) => s.panelWidths);
  // 拖动中折叠（未松手定局）的面板：内容保持挂载但隐藏，反向拖回时状态无损
  const collapsed = useDockStore((s) => s.collapsedPanels.includes(panelId));
  const isLeft = side === 'left';

  const def = PANEL_DEFS[panelId];
  const PanelContent = def ? PANEL_COMPONENTS[panelId] : null;
  const width = panelWidths[panelId] || def?.width || 200;

  // 滞回余量：拖到 ≤160 折叠；反向拖回须超过 160+余量（如 184）才恢复，
  // 避免回撤一两像素就弹出面板造成抖动。
  const COLLAPSE_HYSTERESIS = 24;

  const handleDelta = useCallback((d: number) => {
    const st = useDockStore.getState();
    // 折叠中（未定局）或已正式下架：先调宽，只有宽度**超过下限 + 滞回余量**
    // 才取消折叠/恢复面板（未超过前保持隐藏，避免微动即弹出）。
    const folded = st.collapsedPanels.includes(panelId)
      || (!st.leftPanels.includes(panelId) && !st.rightPanels.includes(panelId));
    if (folded) {
      setPanelWidth(panelId, isLeft ? d : -d);
      const cur = useDockStore.getState().panelWidths[panelId] ?? def?.width ?? 200;
      if (cur > MIN_PANEL_WIDTH + COLLAPSE_HYSTERESIS) {
        useDockStore.getState().openPanel(panelId);
      }
      return;
    }
    setPanelWidth(panelId, isLeft ? d : -d);
  }, [panelId, isLeft, setPanelWidth, def?.width]);

  const handleCommit = useCallback(() => {
    // 松手才判定折叠：拖动过程中不折叠，可来回拖
    commitPanelWidth(panelId);
  }, [panelId, commitPanelWidth]);

  if (!def || !PanelContent) return null;

  return (
    <div className="workspace-side-panel" data-side={side} data-visible={visible ? 'true' : 'false'} style={{
      display: visible ? 'block' : 'none',
      position: 'relative',
      flexShrink: 0,
      minHeight: 0,
    }}>
      <div style={{
        width,
        // Reserve the same frame space as the dock width budget.
        maxWidth: 'calc(100vw - var(--workspace-activity-width) - var(--workspace-terminal-min-width) - var(--workspace-frame-width))',
        display: collapsed ? 'none' : 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        background: 'var(--sidebar-bg)',
        borderRadius: 'inherit', overflow: 'hidden',
      }}>
        <div className="workspace-panel-heading">
          <span>{panelId === 'chat' ? 'AI 助手' : def.label}</span>
          <button data-subtle className="workspace-panel-close" aria-label={`关闭${panelId === 'chat' ? 'AI 助手' : def.label}面板`}
            onClick={() => useDockStore.getState().togglePanel(side, panelId)}><X size={iconSizes.control} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <PanelContent />
        </div>
      </div>

      {/* Keep the resize edge mounted during collapse so dragging back restores the panel. */}
      <ResizeHandle axis="x" edge={isLeft ? 'right' : 'left'} onDelta={handleDelta} onUp={handleCommit} testId={`resize-handle-${panelId}`} />
    </div>
  );
}
