import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import FolderTabs from '@ui/layout/FolderTabs';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import { IconButton } from '@ui/actions/IconButton';
import type { PaneTarget } from '@core/paneLayout';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { flattenSingleSubmenu } from '@ui/menus/menuGroups';
import { Columns2, FolderOpen, Grid, History, Plus } from '@ui/icons';
import { useWorkspaceResources } from '../hooks/useWorkspaceResources';
import { detachCompositionPane, mergeCompositionTab, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useWorkspaceStore } from '../stores/workspace';
import { activateCompositionTab, closeCompositionTab } from '../services/compositionTabs';
import { useUiStore } from '../stores/ui';
import { measureWorkspacePanes, rebindWorkspaceResources, workspacePaneCells, type WorkspaceResource } from '../model/workspaceResources';
import IconCountBadge from '@ui/feedback/IconCountBadge';
import { connectUnifiedAgent, createUnifiedResource, createUnifiedTerminal, focusUnifiedResource, removeUnifiedPane } from '../services/unifiedWorkspace';
import { openWorkspaceFile, pickWorkspaceFile } from '../services/workspaceActions';
import WorkspaceResourceSwitcher from './WorkspaceResourceSwitcher';
import SshResourcesAction from './SshResourcesAction';
import UnifiedStartPage from './UnifiedStartPage';
import AcpLauncher from './AcpLauncher';
import type { TerminalSpec } from '../model/windowLayout';
import NewTabModal from './NewTabModal';
import { useWorkspaceHistory } from '../hooks/useWorkspaceHistory';
import WorkspaceResourceIcon from './WorkspaceResourceIcon';
import { useDefaultShellType } from '../hooks/useDefaultShellType';
import WorkspacePaneCanvas from './WorkspacePaneCanvas';
import { createScopedResource } from '../services/scopedPanes';
import type { EditorFile } from '@core/editor';

type Creation = 'terminal' | 'document' | 'conversation';
type Addition = { kind: 'tab'; id: string } | { kind: 'existing'; id: string } | { kind: 'new'; resource: Creation } | { kind: 'agent'; harness: string; cwd?: string } | { kind: 'terminal'; spec: TerminalSpec } | { kind: 'file'; file: EditorFile };

export default function UnifiedWorkspace({ active }: { active: boolean }) {
  const defaultShellType = useDefaultShellType();
  const resourceIcon = (resource: WorkspaceResource) => <WorkspaceResourceIcon resource={resource} defaultShellType={defaultShellType} />;
  const all = useWorkspaceResources(); const resources = all.filter(resource => resource.kind !== 'page');
  useWorkspaceHistory(resources);
  const state = useUnifiedWorkspace(); const ids = resources.map(resource => resource.id); const key = JSON.stringify(ids);
  const tabs = useWorkspaceStore(store => store.tabs).filter(tab => tab.kind === 'workspace');
  const settingsOpen = useUiStore(store => store.settingsOpen); const visible = active && !settingsOpen;
  const splitButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; split: boolean } | null>(null);
  const [placement, setPlacement] = useState<Addition | null>(null);
  const [launcher, setLauncher] = useState<{ split: boolean; anchor?: DropdownAnchor } | null>(null);
  const [terminalPicker, setTerminalPicker] = useState<{ source: 'shell' | 'ssh'; split: boolean; anchor?: DropdownAnchor } | null>(null);
  const [resourceToolbar, setResourceToolbar] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!active) return;
    if (state.layout) {
      const layout = rebindWorkspaceResources(state.layout, resources);
      if (layout !== state.layout) useUnifiedWorkspace.setState({ layout });
    }
    state.reconcile(ids);
  }, [active, key]);
  const geometry = state.layout && measureWorkspacePanes(state.layout);
  const cells = state.layout ? workspacePaneCells(state.layout) : [];
  const focused = cells.find(cell => cell.id === state.focused) ?? cells[0];
  const placed = new Set(cells.map(cell => cell.resourceId));
  const anchor = (trigger: HTMLButtonElement, split: boolean) => {
    if (split) useUnifiedWorkspace.setState({ zoomed: null });
    const box = trigger.getBoundingClientRect(); setMenu({ anchor: { x: box.right, y: box.bottom + 4, trigger, align: 'end' }, split });
  };
  useEffect(() => {
    if (!state.choosingSplit || !visible || !splitButton.current) return;
    anchor(splitButton.current, true); useUnifiedWorkspace.setState({ choosingSplit: false });
  }, [state.choosingSplit, visible]);
  useEffect(() => {
    if (!visible || !state.pendingTerminalSplit) return;
    setPlacement({ kind: 'terminal', spec: state.pendingTerminalSplit });
    useUnifiedWorkspace.setState({ pendingTerminalSplit: undefined });
  }, [visible, state.pendingTerminalSplit]);
  useEffect(() => { if (!visible) { setMenu(null); setPlacement(null); setLauncher(null); setTerminalPicker(null); } }, [visible]);
  useEffect(() => { setMenu(null); setPlacement(null); setLauncher(null); setTerminalPicker(null); }, [state.activeTabId]);
  const items = tabs.map(tab => {
    const members = tab.paneLayout ? workspacePaneCells(tab.paneLayout).flatMap(cell => resources.filter(resource => resource.id === cell.resourceId)) : [];
    const title = tab.titleSource === 'manual' ? tab.title : members.map(resource => resource.title).join(' + ') || t('Start');
    return { id: tab.id, label: `${title}${members.some(resource => resource.dirty) ? ' •' : ''}`, tip: title, closeLabel: t('Close this tab'),
      icon: <IconCountBadge count={members.length}>{members[0] ? resourceIcon(members[0]) : <Grid size={16} />}</IconCountBadge>,
      surface: members.length ? undefined : 'canvas' as const, renameable: members.length > 0, dataAttributes: { 'data-tab-kind': 'workspace' } };
  });
  const newItem = (kind: Creation) => createUnifiedResource(kind);
  const close = (id: string) => closeCompositionTab(id);
  const history = () => useWorkspaceNavigation.getState().selectHistory('all');
  const remove = () => {
    if (focused) removeUnifiedPane(focused.resourceId);
  };
  const commit = (target: PaneTarget) => {
    if (!placement) return;
    if (placement.kind === 'tab') mergeCompositionTab(placement.id, target);
    else if (placement.kind === 'existing') { state.place(placement.id, target); focusUnifiedResource(placement.id); }
    else if (placement.kind === 'new') createUnifiedResource(placement.resource, undefined, target);
    else if (placement.kind === 'terminal') createUnifiedTerminal(placement.spec, target);
    else if (placement.kind === 'file') { const id = createScopedResource({ file: placement.file }); if (id) { state.place(id, target); focusUnifiedResource(id); } }
    else connectUnifiedAgent(placement.harness, target, placement.cwd);
    setPlacement(null);
  };
  const beginPlacement = (addition: Addition) => { useUnifiedWorkspace.setState({ zoomed: null }); setPlacement(addition); };
  const pickerOrigin = () => ({ split: menu?.split ?? false, anchor: menu ? { x: menu.anchor.x, y: menu.anchor.y, aboveY: menu.anchor.y - 4, align: menu.anchor.align } : undefined });
  const creation: ContextMenuItem[] = [
    { label: t('New terminal'), onClick: () => setTerminalPicker({ source: 'shell', ...pickerOrigin() }) },
    { label: t('Connect a server'), onClick: () => setTerminalPicker({ source: 'ssh', ...pickerOrigin() }) },
    ...(['conversation', 'document'] as const).map(kind => ({ label: t(kind === 'conversation' ? 'New conversation' : 'New file'), onClick: () => menu?.split ? setPlacement({ kind: 'new', resource: kind }) : newItem(kind) })),
    ...(menu?.split ? [{ label: t('Open file'), onClick: () => { void pickWorkspaceFile().then(file => { if (file) setPlacement({ kind: 'file', file }); }); } }] : []),
    { label: t('ACP agents'), onClick: () => setLauncher(pickerOrigin()) },
  ];
  return <section className="unified-workspace" data-testid="unified-workspace" style={{ display: active ? 'flex' : 'none' }} inert={!visible}>
    <WorkspaceHeader active={visible}><FolderTabs label={t('All workspace tabs')} listId="unified-resources"
      items={items}
      selected={state.activeTabId} onSelect={activateCompositionTab} onClose={close}
      onMove={(...args) => state.move(tabs.map(tab => tab.id), ...args)} onRename={(id, title) => useWorkspaceStore.getState().renameTab(id, title)} menuItems={[
        { label: t(state.zoomed ? 'Restore panes' : 'Zoom pane'), disabled: cells.length < 2, onClick: state.single },
        ...(cells.length > 1 && focused ? [{ label: t('Move pane to new tab'), onClick: () => detachCompositionPane(focused.resourceId) }] : []),
        ...(tabs.some(tab => tab.id !== state.activeTabId && tab.paneLayout && workspacePaneCells(tab.paneLayout).length + cells.length <= 4) && cells.length ? [{ label: t('Merge tab into this tab'), submenu: { items: tabs.filter(tab => tab.id !== state.activeTabId && tab.paneLayout && workspacePaneCells(tab.paneLayout).length + cells.length <= 4).map(tab => ({ label: items.find(item => item.id === tab.id)!.tip, onClick: () => beginPlacement({ kind: 'tab', id: tab.id }) })) } }] : []),
        ...(cells.length > 1 ? [{ label: t('Remove pane'), onClick: remove }] : []),
      ]} toolbar={<>
        <WorkspaceResourceSwitcher />
        {!state.startActive && resources.find(resource => resource.id === focused?.resourceId)?.kind === 'terminal' && <SshResourcesAction />}
        <IconButton compact aria-label={t('All history')} data-tip={t('All history')} onClick={history}><History size={16} /></IconButton>
        <span ref={setResourceToolbar} className="unified-resource-actions" />
        <IconButton ref={splitButton} compact aria-label={t('Split tab')} data-tip={t('Split tab')} disabled={state.startActive || !geometry?.targets.length || cells.length >= 4} onClick={event => anchor(event.currentTarget, true)}><Columns2 size={18} /></IconButton>
        <IconButton compact aria-label={t('Open file')} data-tip={t('Open file')} onClick={() => void openWorkspaceFile()}><FolderOpen size={16} /></IconButton>
        <IconButton compact aria-label={t('New workspace tab')} data-tip={t('New workspace tab')} onClick={event => anchor(event.currentTarget, false)}><Plus size={16} /></IconButton>
      </>} /></WorkspaceHeader>
    {state.startActive && <UnifiedStartPage resources={resources} icon={resourceIcon} onSelect={focusUnifiedResource}
      onNew={kind => kind === 'terminal' ? setTerminalPicker({ source: 'shell', split: false }) : newItem(kind)} onOpen={() => void openWorkspaceFile()}
      onConnect={() => setTerminalPicker({ source: 'ssh', split: false })} onAgent={() => setLauncher({ split: false })} onHistory={history} />}
    <WorkspacePaneCanvas layout={state.layout} focused={state.focused} zoomed={state.zoomed} resources={resources} visible={visible && !state.startActive} toolbarTarget={resourceToolbar}
      onFocus={focusUnifiedResource} onRatio={state.ratio} placing={!!placement} onPlace={commit} onCancel={() => setPlacement(null)}
      onSplit={id => { focusUnifiedResource(id); useUnifiedWorkspace.setState({ choosingSplit: true }); }}
      onRemove={removeUnifiedPane} onDetach={detachCompositionPane} onZoom={state.single} />
    {menu && <ContextMenu anchor={menu.anchor} label={t(menu.split ? 'Choose a tab to split' : 'New workspace tab')} itemRole="menuitem" onClose={() => setMenu(null)} items={flattenSingleSubmenu<ContextMenuItem>(menu.split
      ? [...resources.filter(resource => !placed.has(resource.id)).map(resource => ({ label: resource.title, onClick: () => beginPlacement({ kind: 'existing', id: resource.id }) })), { label: t('New workspace tab'), group: 'edit', submenu: { items: creation } }]
      : creation)} />}
    <AcpLauncher open={!!launcher} anchor={launcher?.anchor} onClose={() => setLauncher(null)} onPick={(name, cwd) => {
      if (launcher?.split) setPlacement({ kind: 'agent', harness: name, cwd });
      else connectUnifiedAgent(name, undefined, cwd);
      setLauncher(null);
    }} />
    <NewTabModal open={!!terminalPicker} source={terminalPicker?.source} anchor={terminalPicker?.anchor} onClose={() => setTerminalPicker(null)} onPick={spec => {
      if (terminalPicker?.split) setPlacement({ kind: 'terminal', spec });
      else createUnifiedTerminal(spec);
      setTerminalPicker(null);
    }} />
  </section>;
}
