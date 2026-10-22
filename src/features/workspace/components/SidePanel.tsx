import { useCallback, useContext, type FC } from 'react';
import { iconSizes, X, ArrowLeft } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import { useDockStore, useUiStore, PANEL_DEFS, MIN_PANEL_WIDTH, useNavigationButtonDrag, useNavigationDrag, type DockSide } from '@features/workspace';
import ResizeHandle from '@ui/ResizeHandle';
import PanelFiles from '@features/files/components/PanelFiles';
import AiWorkspaceSurface from '@features/chat/components/AiWorkspaceSurface';
import PanelCommandHistory from '@features/command-history/components/PanelCommandHistory';
import PanelGit from '@features/git/components/PanelGit';
import { t } from '@i18n';
import { PanelSurfaceContext } from './PanelSurfaceContext';

interface SidePanelProps {
  side: DockSide;
}

const PANEL_COMPONENTS: Record<string, FC> = {
  files: PanelFiles,
  chat: () => <AiWorkspaceSurface placement="side" />,
  'command-history': PanelCommandHistory,
  git: PanelGit,
};

export default function SidePanel({ side }: SidePanelProps) {
  const context = useContext(PanelSurfaceContext);
  return <div className="workspace-panel-slot" data-panel-slot={side} ref={context?.[side]} />;
}

export function DockPanel({ side, panelId, visible }: { side: DockSide; panelId: string; visible: boolean }) {
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const startDrag = useNavigationButtonDrag();
  const dragging = useNavigationDrag(state => state.id === panelId);
  const setPanelWidth = useDockStore((s) => s.setPanelWidth);
  const commitPanelWidth = useDockStore((s) => s.commitPanelWidth);
  const panelWidths = useDockStore((s) => s.panelWidths);
  // Retain content during a held collapse so reversing the drag preserves local state.
  const collapsed = useDockStore((s) => side === 'right' && s.collapsedPanels.includes(panelId));

  const def = PANEL_DEFS[panelId];
  const PanelContent = def ? PANEL_COMPONENTS[panelId] : null;
  const width = panelWidths[panelId] || def?.width || 200;

  // A small recovery margin prevents collapse jitter when the pointer reverses.
  const COLLAPSE_HYSTERESIS = 24;

  const handleDelta = useCallback((d: number) => {
    const st = useDockStore.getState();
    const folded = st.collapsedPanels.includes(panelId)
      || !st.rightPanels.includes(panelId);
    if (folded) {
      setPanelWidth(panelId, -d);
      const cur = useDockStore.getState().panelWidths[panelId] ?? def?.width ?? 200;
      if (cur > MIN_PANEL_WIDTH + COLLAPSE_HYSTERESIS) {
        useDockStore.getState().openPanel(panelId);
      }
      return;
    }
    setPanelWidth(panelId, -d);
  }, [panelId, setPanelWidth, def?.width]);

  const handleCommit = useCallback(() => {
    // Finalize the collapsed state only after release.
    commitPanelWidth(panelId);
  }, [panelId, commitPanelWidth]);

  if (!def || !PanelContent) return null;

  return (
    <div className="workspace-side-panel" role="complementary" inert={settingsOpen} aria-hidden={settingsOpen || undefined} aria-label={t('{{panel}} panel', { panel: def.label })} data-side={side} data-visible={visible ? 'true' : 'false'} style={{
      display: visible ? 'block' : 'none',
      position: 'relative',
      flexShrink: 0,
      flex: side === 'left' ? 1 : undefined,
      minHeight: 0,
      minWidth: 0,
    }}>
      <div style={{
        width: side === 'left' ? '100%' : width,
        // Reserve the same frame space as the dock width budget.
        maxWidth: side === 'left' ? undefined : 'calc(100vw - var(--workspace-activity-width) - var(--workspace-terminal-min-width) - var(--workspace-frame-width))',
        display: collapsed ? 'none' : 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        height: '100%',
        background: 'var(--auxiliary-bg)',
        borderRadius: 'inherit', overflow: 'hidden',
      }}>
        <div className="workspace-panel-heading" data-testid={`panel-drag-handle-${panelId}`} data-dragging={dragging}
          onPointerDown={event => startDrag(event, panelId)}>
          <span>{def.label}</span>
          <div className="workspace-panel-heading-actions">
          {panelId === 'chat' && <IconButton compact data-testid="ai-return-to-workspace" aria-label={t('Move AI to workspace')} data-tip={t('Move AI to workspace')}
            onClick={() => {
              const id = useChatStore.getState().activeConversationId;
              if (id) useAiWorkspace.getState().openNative(id);
              selectWorkspaceArea('ai');
            }}><ArrowLeft size={iconSizes.control} /></IconButton>}
          <button data-subtle className="workspace-panel-close" aria-label={t('Close {{panel}} panel', { panel: def.label })}
            onClick={() => useDockStore.getState().closePanel(panelId)}><X size={iconSizes.control} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <PanelContent />
        </div>
      </div>

      {/* Keep the resize edge mounted during collapse so dragging back restores the panel. */}
      {side === 'right' && <ResizeHandle axis="x" edge="left" lineThickness={1} onDelta={handleDelta} onUp={handleCommit} testId={`resize-handle-${panelId}`} />}
    </div>
  );
}
