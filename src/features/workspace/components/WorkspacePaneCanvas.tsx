import { useEffect, useMemo, useRef, useState } from 'react';
import SplitPaneLayout, { type SplitCell } from '@ui/layout/SplitPaneLayout';
import { SplitPaneSurface } from '@ui/layout/SplitPane';
import { ResourceContentSlot } from '@ui/layout/ResourceContent';
import { PlacementOverlay } from '@ui/layout/PanePlacement';
import type { PaneTarget } from '@core/paneLayout';
import { t } from '@i18n';
import ContextMenu from '@ui/menus/ContextMenu';
import { fitWorkspacePanes, measureWorkspacePanes, workspacePaneCells, workspaceSplitDirection, type WorkspacePaneLayout, type WorkspaceResource } from '../model/workspaceResources';

export default function WorkspacePaneCanvas({ layout, focused, zoomed, resources, visible, toolbarTarget, retainHeader, dividerTestPrefix, onFocus, onRatio, placing, onPlace, onCancel, onSplit, onRemove, onDetach, onZoom }: {
  layout: WorkspacePaneLayout | null; focused: string; resources: WorkspaceResource[]; visible: boolean; toolbarTarget?: HTMLElement | null; retainHeader?: boolean;
  onFocus: (id: string) => void; onRatio: (first: string, second: string, ratio: number) => void; placing?: boolean; onPlace: (target: PaneTarget) => void; onCancel: () => void;
  onSplit?: (id: string) => void; onRemove?: (id: string) => void;
  zoomed?: string | null; onDetach?: (id: string) => void; onZoom?: () => void;
  dividerTestPrefix?: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => { if (!visible) { setMenu(null); if (placing) onCancel(); } }, [visible, placing, onCancel]);
  useEffect(() => {
    const element = body.current; if (!element || !visible) return;
    const update = () => { if (element.clientWidth > 0 && element.clientHeight > 0) setSize({ width: element.clientWidth, height: element.clientHeight }); };
    const observer = new ResizeObserver(update); observer.observe(element); update(); return () => observer.disconnect();
  }, [visible]);
  const shown = zoomed && layout ? workspacePaneCells(layout).find(cell => cell.id === zoomed) : null;
  const displayLayout: WorkspacePaneLayout | null = shown ? { type: 'pane', ...shown } : layout;
  const fitted = useMemo(() => displayLayout && fitWorkspacePanes(displayLayout, size.width, size.height), [displayLayout, size]);
  const geometry = useMemo(() => fitted && measureWorkspacePanes(fitted.layout), [fitted]);
  const cells = layout ? workspacePaneCells(layout) : [];
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
    {menu && visible && <ContextMenu anchor={menu} label={t('Pane actions')} itemRole="menuitem" onClose={() => setMenu(null)} items={[
      ...(onSplit && cells.length < 4 ? [{ label: t('Split tab'), onClick: () => onSplit(menu.id) }] : []),
      ...(onZoom && cells.length > 1 ? [{ label: t(zoomed ? 'Restore panes' : 'Zoom pane'), onClick: onZoom }] : []),
      ...(onDetach && cells.length > 1 ? [{ label: t('Move pane to new tab'), onClick: () => onDetach(menu.id) }] : []),
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
