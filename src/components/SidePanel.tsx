import { type FC, useCallback } from 'react';
import PanelChat from '@/chat/PanelChat';
import PanelTabs from '@/components/PanelTabs';
import ResizeHandle from '@/components/ResizeHandle';
import PanelFiles from '@/files/PanelFiles';
import { cx } from '@/shared/utils/cx';
import PanelSsh from '@/ssh/PanelSsh';
import { type DockSide, MIN_PANEL_WIDTH, PANEL_DEFS, useDockStore } from '@/store/dock';
import { isSessionTab, useWorkspaceStore } from '@/store/workspace';
import s from './SidePanel.module.css';

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
  const commitPanelWidth = useDockStore((s) => s.commitPanelWidth);
  const panelWidths = useDockStore((s) => s.panelWidths);
  const collapsed = useDockStore((s) => s.collapsedPanels.includes(panelId));
  const isLeft = side === 'left';

  const def = PANEL_DEFS[panelId];
  const PanelContent = def ? PANEL_COMPONENTS[panelId] : null;
  const width = panelWidths[panelId] || def?.width || 200;

  const COLLAPSE_HYSTERESIS = 24;

  const handleDelta = useCallback(
    (d: number) => {
      const st = useDockStore.getState();
      const folded =
        st.collapsedPanels.includes(panelId) ||
        (!st.leftPanels.includes(panelId) && !st.rightPanels.includes(panelId));
      if (folded) {
        setPanelWidth(panelId, isLeft ? d : -d);
        const cur = useDockStore.getState().panelWidths[panelId] ?? def?.width ?? 200;
        if (cur > MIN_PANEL_WIDTH + COLLAPSE_HYSTERESIS) {
          useDockStore.getState().openPanel(panelId);
        }
        return;
      }
      setPanelWidth(panelId, isLeft ? d : -d);
    },
    [panelId, isLeft, setPanelWidth, def?.width],
  );

  const handleCommit = useCallback(() => {
    commitPanelWidth(panelId);
  }, [panelId, commitPanelWidth]);

  if (!def || !PanelContent) return null;

  return (
    <div className={cx(s.wrapper, isLeft ? s.wrapperLeft : s.wrapperRight)}>
      <div className={cx(s.panel, collapsed && s.panelCollapsed)} style={{ width }}>
        <div className={s.content}>
          <PanelContent />
        </div>
      </div>

      <ResizeHandle
        axis="x"
        edge={isLeft ? 'right' : 'left'}
        onDelta={handleDelta}
        onUp={handleCommit}
        testId={`resize-handle-${panelId}`}
      />
    </div>
  );
}
