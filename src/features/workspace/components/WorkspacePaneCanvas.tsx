import { useEffect, useMemo, useRef, useState } from 'react';
import SplitPaneLayout, { type SplitCell } from '@ui/layout/SplitPaneLayout';
import { SplitPaneSurface } from '@ui/layout/SplitPane';
import { ResourceContentSlot } from '@ui/layout/ResourceContent';
import { PlacementOverlay } from '@ui/layout/PanePlacement';
import type { PaneTarget } from '@core/paneLayout';
import { t } from '@i18n';
import ContextMenu from '@ui/menus/ContextMenu';
import { fitWorkspacePanes, measureWorkspacePanes, pruneWorkspacePanes, workspacePaneCells, workspaceSplitDirection, type WorkspacePaneLayout, type WorkspaceResource } from '../model/workspaceResources';
import { useUiStore } from '../stores/ui';

export default function WorkspacePaneCanvas({ containerId, layout, focused, resources, visible, toolbarTarget, retainHeader, dividerTestPrefix, onFocus, onRatio, placing, onPlace, onCancel, onSplit, onRemove, onDetach, onMovePane }: {
  containerId: string; layout: WorkspacePaneLayout | null; focused: string; resources: WorkspaceResource[]; visible: boolean; toolbarTarget?: HTMLElement | null; retainHeader?: boolean;
  onFocus: (id: string) => void; onRatio: (first: string, second: string, ratio: number) => void; placing?: boolean; onPlace: (target: PaneTarget) => void; onCancel: () => void;
  onSplit?: (id: string) => void; onRemove?: (id: string) => void;
  onDetach?: (id: string) => void; onMovePane?: (paneId: string, target: PaneTarget) => void;
  dividerTestPrefix?: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const paneMove = useUiStore(state => state.paneMove);
  const beginPaneMove = useUiStore(state => state.beginPaneMove);
  const cancelPaneMove = useUiStore(state => state.cancelPaneMove);
  const moving = paneMove.open && paneMove.containerId === containerId ? paneMove.paneId : '';
  const cancelPlacement = useRef(onCancel);
  cancelPlacement.current = onCancel;
  useEffect(() => { if (!visible) setMenu(null); }, [visible]);
  useEffect(() => { if (!visible && placing) cancelPlacement.current(); }, [visible, placing]);
  useEffect(() => { if (!visible && moving) cancelPaneMove(); }, [visible, moving, cancelPaneMove]);
  useEffect(() => {
    const element = body.current; if (!element || !visible) return;
    const update = () => {
      const width = element.clientWidth; const height = element.clientHeight;
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(update); observer.observe(element); update(); return () => observer.disconnect();
  }, [visible]);
  const fitted = useMemo(() => layout && fitWorkspacePanes(layout, size.width, size.height), [layout, size]);
  const geometry = useMemo(() => fitted && measureWorkspacePanes(fitted.layout), [fitted]);
  const cells = layout ? workspacePaneCells(layout) : [];
  const movingTargets = useMemo(() => {
    if (!layout || !moving) return [];
    const current = workspacePaneCells(layout);
    if (!current.some(cell => cell.id === moving)) return [];
    const remaining = pruneWorkspacePanes(layout, new Set(current.filter(cell => cell.id !== moving).map(cell => cell.resourceId)));
    return remaining ? measureWorkspacePanes(remaining).targets : [];
  }, [layout, moving]);
  // A narrow window may stack a horizontal split. Dragging the adapted divider must not
  // write its vertical ratio back into the saved horizontal layout.
  const persistRatio = (aId: string, bId: string, ratio: number) => {
    const displayed = geometry?.dividers.find(line => line.aId === aId && line.bId === bId);
    if (!displayed || !layout || displayed.dir !== workspaceSplitDirection(layout, aId, bId)) return;
    onRatio(aId, bId, ratio);
  };
  return <div className="unified-pane-canvas" ref={body} style={{ display: visible ? undefined : 'none' }}>
    {geometry && <SplitPaneLayout {...geometry} dividerTestPrefix={dividerTestPrefix} style={{ height: fitted!.height }} minHeight={200} onRatio={persistRatio} renderPane={cell => {
      const resourceId = cells.find(item => item.id === cell.id)?.resourceId;
      const resource = resources.find(item => item.id === resourceId);
      return resource && <WorkspacePaneHost resource={resource} cell={cell} visible={visible} focused={cell.id === focused} toolbarTarget={toolbarTarget} retainHeader={retainHeader} onFocus={onFocus}
        onMenu={(event) => { onFocus(resource.id); setMenu({ id: resource.id, x: event.clientX, y: event.clientY }); }} />;
    }}>{placing && <PlacementOverlay targets={geometry.targets} onPick={onPlace} onCancel={onCancel} hint={t('Choose a split position')} />}</SplitPaneLayout>}
    {moving && visible && <PlacementOverlay targets={movingTargets} onPick={target => { onMovePane?.(moving, target); cancelPaneMove(); }} onCancel={cancelPaneMove} zIndex={110}
      hint={t('Choose a pane position')} emptyMessage={t('A single pane cannot be moved')} />}
    {menu && visible && <ContextMenu anchor={menu} label={t('Pane actions')} itemRole="menuitem" onClose={() => setMenu(null)} items={[
      ...(onSplit && cells.length < 4 ? [{ label: t('Split tab'), onClick: () => onSplit(menu.id) }] : []),
      ...(onMovePane ? [{ label: t('Change pane position'), disabled: cells.length < 2, onClick: () => {
        const cell = cells.find(cell => cell.resourceId === menu.id);
        if (cell) beginPaneMove(containerId, cell.id);
        setMenu(null);
      } }] : []),
      ...(onDetach ? [{ label: t('Move pane to new tab'), disabled: cells.length < 2, onClick: () => onDetach(menu.id) }] : []),
      ...(onRemove && cells.length > 1 ? [{ label: t('Remove pane'), onClick: () => onRemove(menu.id) }] : []),
    ]} />}
  </div>;
}

function WorkspacePaneHost({ resource, cell, visible, focused, toolbarTarget, retainHeader, onFocus, onMenu }: {
  resource: WorkspaceResource; cell: SplitCell; visible: boolean; focused: boolean; toolbarTarget?: HTMLElement | null; retainHeader?: boolean; onFocus: (id: string) => void; onMenu: (event: MouseEvent) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current; if (!element || !visible || focused) return;
    const focus = () => onFocus(resource.id);
    element.addEventListener('pointerdown', focus, true); element.addEventListener('focusin', focus, true);
    return () => { element.removeEventListener('pointerdown', focus, true); element.removeEventListener('focusin', focus, true); };
  }, [resource.id, visible, focused, onFocus]);
  useEffect(() => {
    const element = host.current; if (!element || !visible || resource.kind === 'terminal') return;
    const context = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); onMenu(event); };
    element.addEventListener('contextmenu', context, true); return () => element.removeEventListener('contextmenu', context, true);
  }, [resource.kind, visible, onMenu]);
  return <SplitPaneSurface ref={host} inner={cell.inner} className="unified-pane" data-resource-id={resource.id} data-focused={focused || undefined}>
    <ResourceContentSlot id={resource.id} visible={visible} focused={focused} toolbarTarget={toolbarTarget} retainHeader={retainHeader} />
  </SplitPaneSurface>;
}
