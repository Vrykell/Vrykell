import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@i18n';
import FolderTabs from '@ui/layout/FolderTabs';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import { ResourceContentSlot } from '@ui/layout/ResourceContent';
import { IconButton } from '@ui/actions/IconButton';
import SplitPaneLayout, { type SplitCell } from '@ui/layout/SplitPaneLayout';
import { SplitPaneSurface } from '@ui/layout/SplitPane';
import { PlacementOverlay } from '@ui/layout/PanePlacement';
import type { PaneTarget } from '@core/paneLayout';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import AppMark from '@ui/icons/AppMark';
import { Bot, Columns2, FolderOpen, Grid, History, Plus, TerminalPrompt } from '@ui/icons';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { fileIcon } from '@features/files';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import { useWorkspaceResources } from '../hooks/useWorkspaceResources';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkspaceNavigation, orderedWorkspaceIds } from '../stores/navigation';
import { useWorkspaceStore as useSessionStore } from '../stores/workspace';
import { useUiStore } from '../stores/ui';
import { fitWorkspacePanes, measureWorkspacePanes, workspacePaneCells, type WorkspaceResource } from '../model/workspaceResources';
import { closeWorkspaceResource, renameWorkspaceResource } from '../services/workspaceResources';
import { connectUnifiedAgent, createUnifiedResource, focusUnifiedResource } from '../services/unifiedWorkspace';
import { openWorkspaceFile } from '../services/workspaceActions';
import WorkspaceResourceSwitcher from './WorkspaceResourceSwitcher';
import SshResourcesAction from './SshResourcesAction';
import UnifiedStartPage from './UnifiedStartPage';
import AcpLauncher from './AcpLauncher';
import { firstLeaf } from '../model/windowLayout';

type Creation = 'terminal' | 'document' | 'conversation';
type Addition = { kind: 'existing'; id: string } | { kind: 'new'; resource: Creation } | { kind: 'agent'; harness: string };
const START = 'unified:start';

function resourceIcon(resource: WorkspaceResource) {
  if (resource.kind === 'conversation') return <AppMark size={16} />;
  if (resource.kind === 'agent') { const Mark = harnessMark(resource.title, Bot); return <Mark size={16} />; }
  if (resource.kind === 'terminal') {
    const tab = useSessionStore.getState().tabs.find(tab => tab.id === resource.tabId);
    const terminal = tab?.kind === 'session' ? firstLeaf(tab.layout) : undefined;
    return terminal ? <TerminalProfileIcon kind={terminal.kind} shellType={terminal.shellType} connectionId={terminal.ssh?.connectionId} size={16} /> : <TerminalPrompt size={16} />;
  }
  const Icon = fileIcon(resource.title); return <Icon size={16} />;
}

export default function UnifiedWorkspace({ active }: { active: boolean }) {
  const all = useWorkspaceResources(); const resources = all.filter(resource => resource.kind !== 'page');
  const state = useUnifiedWorkspace(); const ids = resources.map(resource => resource.id); const key = JSON.stringify(ids);
  const settingsOpen = useUiStore(store => store.settingsOpen); const visible = active && !settingsOpen;
  const body = useRef<HTMLDivElement>(null); const splitButton = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; split: boolean } | null>(null);
  const [placement, setPlacement] = useState<Addition | null>(null);
  const [launcher, setLauncher] = useState<'new' | 'split' | null>(null);
  const [resourceToolbar, setResourceToolbar] = useState<HTMLSpanElement | null>(null);
  const previousIds = useRef(new Set(ids));
  useEffect(() => {
    if (!active) { previousIds.current = new Set(ids); return; }
    state.reconcile(ids);
    const added = ids.filter(id => !previousIds.current.has(id)); previousIds.current = new Set(ids);
    if (added.length) focusUnifiedResource(added[added.length - 1]!);
  }, [active, key]);
  useEffect(() => {
    const element = body.current; if (!element) return;
    const update = () => { if (element.clientWidth > 0 && element.clientHeight > 0) setSize({ width: element.clientWidth, height: element.clientHeight }); };
    const observer = new ResizeObserver(update); observer.observe(element); update(); return () => observer.disconnect();
  }, [state.startActive]);
  const fitted = useMemo(() => state.layout && fitWorkspacePanes(state.layout, size.width, size.height), [state.layout, size]);
  const geometry = useMemo(() => fitted && measureWorkspacePanes(fitted.layout), [fitted]);
  const cells = state.layout ? workspacePaneCells(state.layout) : [];
  const focused = cells.find(cell => cell.id === state.focused) ?? cells[0];
  const placed = new Set(cells.map(cell => cell.resourceId));
  const anchor = (trigger: HTMLButtonElement, split: boolean) => {
    const box = trigger.getBoundingClientRect(); setMenu({ anchor: { x: box.right, y: box.bottom + 4, trigger, align: 'end' }, split });
  };
  useEffect(() => {
    if (!state.choosingSplit || !visible || !splitButton.current) return;
    anchor(splitButton.current, true); useUnifiedWorkspace.setState({ choosingSplit: false });
  }, [state.choosingSplit, visible]);
  useEffect(() => { if (!visible) { setMenu(null); setPlacement(null); setLauncher(null); } }, [visible]);
  const items = orderedWorkspaceIds(ids, state.order).flatMap(id => {
    const resource = resources.find(item => item.id === id);
    return resource ? [{ id, label: `${resource.title}${resource.dirty ? ' •' : ''}`, tip: resource.title, closeLabel: t('Close this tab'), icon: resourceIcon(resource), renameable: resource.kind === 'terminal' || resource.kind === 'conversation' }] : [];
  });
  const newItem = (kind: Creation) => createUnifiedResource(kind);
  const close = (id: string) => {
    if (id === START) { state.closeStart(); return; }
    const resource = resources.find(item => item.id === id); if (resource) closeWorkspaceResource(resource);
    useWorkspaceNavigation.getState().selectArea('unified');
  };
  const history = () => useWorkspaceNavigation.getState().selectHistory('all');
  const remove = () => {
    if (!focused) return; state.removePane(focused.id);
    const next = useUnifiedWorkspace.getState(); const cell = next.layout && workspacePaneCells(next.layout).find(cell => cell.id === next.focused);
    if (cell) focusUnifiedResource(cell.resourceId);
  };
  const commit = (target: PaneTarget) => {
    if (!placement) return;
    if (placement.kind === 'existing') { state.place(placement.id, target); focusUnifiedResource(placement.id); }
    else if (placement.kind === 'new') createUnifiedResource(placement.resource, undefined, target);
    else connectUnifiedAgent(placement.harness, target);
    setPlacement(null);
  };
  const creation: ContextMenuItem[] = [
    ...(['terminal', 'document', 'conversation'] as const).map((kind, index) => ({ label: t(['New terminal', 'New file', 'New conversation'][index]!), onClick: () => menu?.split ? setPlacement({ kind: 'new', resource: kind }) : newItem(kind) })),
    { label: t('Connect a server'), onClick: () => setLauncher(menu?.split ? 'split' : 'new') },
  ];
  return <section className="unified-workspace" data-testid="unified-workspace" style={{ display: active ? 'flex' : 'none' }} inert={!visible}>
    <WorkspaceHeader active={visible}><FolderTabs label={t('All workspace tabs')} listId="unified-resources"
      items={[...(state.startOpen ? [{ id: START, label: t('Start'), tip: t('Unified workspace'), closeLabel: t('Close this tab'), icon: <Grid size={16} />, surface: 'canvas' as const, renameable: false }] : []), ...items]}
      selected={state.startActive ? START : focused?.resourceId ?? ''} onSelect={id => id === START ? state.openStart() : focusUnifiedResource(id)} onClose={close}
      onMove={(...args) => state.move(ids, ...args)} onRename={(id, title) => { const resource = resources.find(item => item.id === id); if (resource) renameWorkspaceResource(resource, title); }} menuItems={[
        { label: t('Start page'), onClick: state.openStart }, { label: t('Single pane'), disabled: cells.length < 2, onClick: state.single },
        { label: t('Remove pane'), disabled: cells.length < 2, onClick: remove },
      ]} toolbar={<>
        <WorkspaceResourceSwitcher />
        {!state.startActive && resources.find(resource => resource.id === focused?.resourceId)?.kind === 'terminal' && <SshResourcesAction />}
        <IconButton compact aria-label={t('All history')} data-tip={t('All history')} onClick={history}><History size={16} /></IconButton>
        <span ref={setResourceToolbar} className="unified-resource-actions" />
        <IconButton ref={splitButton} compact aria-label={t('Split tab')} data-tip={t('Split tab')} disabled={state.startActive || !geometry?.targets.length || cells.length >= 4} onClick={event => anchor(event.currentTarget, true)}><Columns2 size={18} /></IconButton>
        <IconButton compact aria-label={t('Open file')} data-tip={t('Open file')} onClick={() => void openWorkspaceFile()}><FolderOpen size={16} /></IconButton>
        <IconButton compact aria-label={t('New workspace tab')} data-tip={t('New workspace tab')} onClick={event => anchor(event.currentTarget, false)}><Plus size={16} /></IconButton>
      </>} /></WorkspaceHeader>
    {state.startActive && <UnifiedStartPage resources={resources} icon={resourceIcon} onSelect={focusUnifiedResource} onNew={newItem} onOpen={() => void openWorkspaceFile()} onConnect={() => setLauncher('new')} onHistory={history} />}
    <div className="unified-pane-canvas" ref={body} style={{ display: state.startActive ? 'none' : undefined }}>
      {geometry && <SplitPaneLayout {...geometry} style={{ height: fitted!.height }} minHeight={200} onRatio={state.ratio} renderPane={cell => {
        const resourceId = cells.find(item => item.id === cell.id)?.resourceId; const resource = resources.find(item => item.id === resourceId);
        return resource && <MixedPane resource={resource} cell={cell} focused={cell.id === state.focused} visible={visible && !state.startActive} toolbarTarget={resourceToolbar} />;
      }}>{placement && <PlacementOverlay targets={geometry.targets} onPick={commit} onCancel={() => setPlacement(null)} hint={t('Choose a split position')} />}</SplitPaneLayout>}
    </div>
    {menu && <ContextMenu anchor={menu.anchor} label={t(menu.split ? 'Choose a tab to split' : 'New workspace tab')} itemRole="menuitem" onClose={() => setMenu(null)} items={menu.split
      ? [...resources.filter(resource => !placed.has(resource.id)).map(resource => ({ label: resource.title, onClick: () => setPlacement({ kind: 'existing', id: resource.id }) })), { label: t('New workspace tab'), group: 'edit', submenu: { items: creation } }]
      : creation} />}
    <AcpLauncher open={!!launcher} onClose={() => setLauncher(null)} onPick={name => {
      if (launcher === 'split') setPlacement({ kind: 'agent', harness: name });
      else connectUnifiedAgent(name);
      setLauncher(null);
    }} />
  </section>;
}

function MixedPane({ resource, cell, focused, visible, toolbarTarget }: { resource: WorkspaceResource; cell: SplitCell; focused: boolean; visible: boolean; toolbarTarget: HTMLElement | null }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current; if (!element || !visible || focused) return;
    const focus = () => focusUnifiedResource(resource.id);
    element.addEventListener('pointerdown', focus, true); element.addEventListener('focusin', focus, true);
    return () => { element.removeEventListener('pointerdown', focus, true); element.removeEventListener('focusin', focus, true); };
  }, [resource.id, visible, focused]);
  return <SplitPaneSurface ref={host} inner={cell.inner} className="unified-pane" data-resource-id={resource.id} data-focused={focused || undefined}>
    <ResourceContentSlot id={resource.id} visible={visible} focused={focused} toolbarTarget={toolbarTarget} />
  </SplitPaneSurface>;
}
