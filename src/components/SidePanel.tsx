import { useCallback, type FC } from 'react';
import { useDockStore, type DockSide, PANEL_DEFS } from '../stores/dock';
import ResizeHandle from './ResizeHandle';
import PanelTabs from './PanelTabs';
import PanelFiles from '../files/PanelFiles';
import PanelSsh from '../ssh/PanelSsh';

interface SidePanelProps {
  side: DockSide;
}

const PANEL_COMPONENTS: Record<string, FC> = {
  tabs: PanelTabs,
  files: PanelFiles,
  ssh: PanelSsh,
};

export default function SidePanel({ side }: SidePanelProps) {
  const leftPanels = useDockStore((s) => s.leftPanels);
  const rightPanels = useDockStore((s) => s.rightPanels);

  const panelIds = side === 'left' ? leftPanels : rightPanels;
  if (panelIds.length === 0) return null;

  return (
    <>
      {panelIds.map((panelId) => (
        <SinglePanel key={panelId} side={side} panelId={panelId} />
      ))}
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
    const newW = isLeft ? width + d : width - d;
    setPanelWidth(panelId, newW);
  }, [panelId, width, isLeft, setPanelWidth]);

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
