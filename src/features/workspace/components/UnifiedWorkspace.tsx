import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import FolderTabs from '@ui/layout/FolderTabs';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import { IconButton } from '@ui/actions/IconButton';
import type { PaneTarget } from '@core/paneLayout';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { flattenSingleSubmenu } from '@ui/menus/menuGroups';
import { FolderOpen, History, PanelRight, Plus } from '@ui/icons';
import { useWorkspaceResources } from '../hooks/useWorkspaceResources';
import { detachCompositionPane, mergeCompositionTab, useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUiStore } from '../stores/ui';
import { rebindWorkspaceResources, workspacePaneCells, type WorkspaceResource } from '../model/workspaceResources';
import { connectUnifiedAgent, createUnifiedResource, createUnifiedTerminal, focusUnifiedResource, reconcileUnifiedResources, removeUnifiedPane } from '../services/unifiedWorkspace';
import { moveWorkspacePane } from '../services/workbench';
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
import { useUnifiedWorkspaceTabs } from '../hooks/useUnifiedWorkspaceTabs';
import type { EditorFile } from '@core/editor';
import { useWorkbenchStore } from '../stores/workbench';
import { requestWorkspaceSplit } from '../services/unifiedWorkspace';
import { moveMainConversationToSide } from '@features/chat/services/aiWorkspace';

type Creation = 'terminal' | 'document' | 'conversation';
type Addition = { kind: 'tab'; id: string } | { kind: 'existing'; id: string } | { kind: 'new'; resource: Creation } | { kind: 'agent'; harness: string; cwd?: string } | { kind: 'terminal'; spec: TerminalSpec } | { kind: 'file'; file: EditorFile };

export default function UnifiedWorkspace({ active }: { active: boolean }) {
  const defaultShellType = useDefaultShellType();
  const resourceIcon = (resource: WorkspaceResource) => <WorkspaceResourceIcon resource={resource} defaultShellType={defaultShellType} />;
  const all = useWorkspaceResources(); const resources = all.filter(resource => resource.kind !== 'page');
  useWorkspaceHistory(resources);
  const state = useUnifiedWorkspace(); const ids = resources.map(resource => resource.id); const key = JSON.stringify(ids);
  const ready = useWorkbenchStore(store => store.ready);
  const strip = useUnifiedWorkspaceTabs(resources, resourceIcon);
  const settingsOpen = useUiStore(store => store.settingsOpen); const visible = active && !settingsOpen;
  const newButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; split: boolean } | null>(null);
  const [placement, setPlacement] = useState<Addition | null>(null);
  const [launcher, setLauncher] = useState<{ split: boolean; anchor?: DropdownAnchor } | null>(null);
  const [terminalPicker, setTerminalPicker] = useState<{ source: 'shell' | 'ssh'; split: boolean; anchor?: DropdownAnchor } | null>(null);
  const [resourceToolbar, setResourceToolbar] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!active || !ready) return;
    if (state.layout) {
      const layout = rebindWorkspaceResources(state.layout, resources);
      if (layout !== state.layout) useUnifiedWorkspace.setState({ layout });
    }
    reconcileUnifiedResources(ids);
  }, [active, key, ready]);
  const cells = state.layout ? workspacePaneCells(state.layout) : [];
  const focused = cells.find(cell => cell.id === state.focused) ?? cells[0];
  const placed = new Set(cells.map(cell => cell.resourceId));
  const anchor = (trigger: HTMLButtonElement, split: boolean) => {
    const box = trigger.getBoundingClientRect(); setMenu({ anchor: { x: box.right, y: box.bottom + 4, trigger, align: 'end' }, split });
  };
  useEffect(() => {
    if (!state.choosingSplit || !visible || !newButton.current) return;
    const kind = state.splitCreation;
    const box = newButton.current.getBoundingClientRect();
    const origin: DropdownAnchor = { x: box.right, y: box.bottom + 4, aboveY: box.top, align: 'end' };
    if (kind === 'terminal' || kind === 'ssh') setTerminalPicker({ source: kind === 'ssh' ? 'ssh' : 'shell', split: true, anchor: origin });
    else if (kind === 'document' || kind === 'conversation') setPlacement({ kind: 'new', resource: kind });
    else if (kind === 'file') void pickWorkspaceFile().then(file => { if (file) setPlacement({ kind: 'file', file }); });
    else if (kind === 'agent') setLauncher({ split: true, anchor: origin });
    else anchor(newButton.current, true);
    useUnifiedWorkspace.setState({ choosingSplit: false, splitCreation: undefined });
  }, [state.choosingSplit, state.splitCreation, visible]);
  useEffect(() => { if (state.pendingMergeTab) setPlacement({ kind: 'tab', id: state.pendingMergeTab }); }, [state.pendingMergeTab]);
  useEffect(() => { if (!visible) { setMenu(null); setPlacement(null); setLauncher(null); setTerminalPicker(null); } }, [visible]);
  useEffect(() => { setMenu(null); setPlacement(null); setLauncher(null); setTerminalPicker(null); }, [state.activeTabId]);
  const newItem = (kind: Creation) => createUnifiedResource(kind);
  const history = () => useWorkspaceNavigation.getState().selectHistory('all');
  const commit = (target: PaneTarget) => {
    if (!placement) return;
    if (placement.kind === 'tab') mergeCompositionTab(placement.id, target);
    else if (placement.kind === 'existing') { state.place(placement.id, target); focusUnifiedResource(placement.id); }
    else if (placement.kind === 'new') createUnifiedResource(placement.resource, undefined, target);
    else if (placement.kind === 'terminal') createUnifiedTerminal(placement.spec, target);
    else if (placement.kind === 'file') { const id = createScopedResource({ file: placement.file }); if (id) { state.selectTab(state.activeTabId); state.place(id, target); focusUnifiedResource(id); } }
    else connectUnifiedAgent(placement.harness, target, placement.cwd);
    setPlacement(null);
    state.chooseMerge();
  };
  const beginPlacement = (addition: Addition) => { setPlacement(addition); };
  const pickerOrigin = (origin?: MenuAnchor) => {
    const preferred = origin ?? menu?.anchor;
    return { split: menu?.split ?? false,
      anchor: preferred ? { x: preferred.x, y: preferred.y, aboveY: preferred.y - 4, align: preferred.align } : undefined };
  };
  const creation: ContextMenuItem[] = [
    { label: t('New terminal'), onClick: origin => setTerminalPicker({ source: 'shell', ...pickerOrigin(origin) }) },
    { label: t('Connect a server'), onClick: origin => setTerminalPicker({ source: 'ssh', ...pickerOrigin(origin) }) },
    ...(['conversation', 'document'] as const).map(kind => ({ label: t(kind === 'conversation' ? 'New conversation' : 'New file'), onClick: () => menu?.split ? setPlacement({ kind: 'new', resource: kind }) : newItem(kind) })),
    ...(menu?.split ? [{ label: t('Open file'), onClick: () => { void pickWorkspaceFile().then(file => { if (file) setPlacement({ kind: 'file', file }); }); } }] : []),
    { label: t('ACP agents'), onClick: origin => setLauncher(pickerOrigin(origin)) },
  ];
  const focusedResource = resources.find(resource => resource.id === focused?.resourceId);
  return <section className="unified-workspace" data-testid="unified-workspace" style={{ display: active ? 'flex' : 'none' }} inert={!visible}>
    <WorkspaceHeader active={visible}><FolderTabs label={t('All workspace tabs')} listId="unified-resources"
      leading={<WorkspaceResourceSwitcher destination="unified" />}
      items={strip.handles}
      selected={state.activeTabId} onSelect={strip.onSelect} onClose={strip.onClose}
      onMove={strip.onMove} grouping={strip.grouping} onRename={strip.onRename} tabActions={strip.tabActions} menuLabel={t('Workspace actions')} menuItems={[
        ...(strip.tabActions?.(state.activeTabId) ?? []), ...creation,
        { label: t('Open file'), onClick: () => void openWorkspaceFile() },
        { label: t('All history'), onClick: history },
      ]} toolbar={<>
        {!state.startActive && resources.find(resource => resource.id === focused?.resourceId)?.kind === 'terminal' && <SshResourcesAction />}
        <IconButton compact aria-label={t('All history')} data-tip={t('All history')} onClick={history}><History size={16} /></IconButton>
        <span ref={setResourceToolbar} className="unified-resource-actions" />
        {!state.startActive && focusedResource && (focusedResource.kind === 'conversation' || focusedResource.kind === 'agent') && <IconButton compact aria-label={t('Dock AI to side')} data-tip={t('Dock AI to side')} onClick={() => {
          moveMainConversationToSide(focusedResource.id);
        }}><PanelRight size={16} /></IconButton>}
        <IconButton compact aria-label={t('Open file')} data-tip={t('Open file')} onClick={() => void openWorkspaceFile()}><FolderOpen size={16} /></IconButton>
        <IconButton ref={newButton} compact aria-label={t('New workspace tab')} data-tip={t('New workspace tab')} onClick={event => anchor(event.currentTarget, false)}><Plus size={16} /></IconButton>
      </>} /></WorkspaceHeader>
    {state.startActive && <UnifiedStartPage resources={resources} icon={resource => <WorkspaceResourceIcon resource={resource} size={28} defaultShellType={defaultShellType} />} onSelect={focusUnifiedResource}
      onNew={kind => kind === 'terminal' ? setTerminalPicker({ source: 'shell', split: false }) : newItem(kind)} onOpen={() => void openWorkspaceFile()}
      onConnect={() => setTerminalPicker({ source: 'ssh', split: false })} onAgent={() => setLauncher({ split: false })} onHistory={history} />}
    <WorkspacePaneCanvas containerId={state.activeTabId} layout={state.layout} focused={state.focused} resources={resources} visible={visible && !state.startActive} toolbarTarget={resourceToolbar}
      onFocus={focusUnifiedResource} onRatio={state.ratio} placing={!!placement} onPlace={commit} onCancel={() => { setPlacement(null); state.chooseMerge(); }}
      onSplit={(id, kind) => requestWorkspaceSplit(id, undefined, kind)}
      onMovePane={(paneId, target) => moveWorkspacePane(state.activeTabId, paneId, target)}
      onRemove={removeUnifiedPane} onDetach={detachCompositionPane} />
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
