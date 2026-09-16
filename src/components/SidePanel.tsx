import { useCallback, type FC } from 'react';
import { useDockStore, PANEL_DEFS, MIN_PANEL_WIDTH, type DockSide } from '@shared/ui';
import { selectActiveSessionTab, useSessionStore } from '@entities/session';
import ResizeHandle from './ResizeHandle';
import PanelTabs from './PanelTabs';
import PanelFiles from '@features/files/PanelFiles';
import PanelSsh from '@features/ssh/PanelSsh';
import PanelChat from '@features/chat/PanelChat';

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
    <div style={{
      position: 'relative',
      flexShrink: 0,
      minHeight: 0,
      ...(isLeft
        ? { borderRight: '1px solid var(--block-divider)' }
        : { borderLeft: '1px solid var(--block-divider)' }),
    }}>
      <div style={{
        width,
        display: collapsed ? 'none' : 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        background: 'var(--surface)',
      }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <PanelContent />
        </div>
      </div>

      {/* 拖拽手柄 — 绝对定位覆盖在内边缘，无可见缝隙；折叠中手柄仍在，可反向拖回 */}
      <ResizeHandle axis="x" edge={isLeft ? 'right' : 'left'} onDelta={handleDelta} onUp={handleCommit} testId={`resize-handle-${panelId}`} />
    </div>
  );
}
