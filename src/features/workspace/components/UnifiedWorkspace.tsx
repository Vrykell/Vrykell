import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@i18n';
import FolderTabs from '@ui/layout/FolderTabs';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import { ResourceContentSlot } from '@ui/layout/ResourceContent';
import { IconButton } from '@ui/actions/IconButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import ResizeHandle from '@ui/layout/ResizeHandle';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import AppMark from '@ui/icons/AppMark';
import { Columns2, FileCode, FolderOpen, History, Plus, TerminalPrompt, X } from '@ui/icons';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { fileIcon } from '@features/files';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { newEditorFile } from '@features/editor/services/documentActions';
import { useWorkspaceResources } from '../hooks/useWorkspaceResources';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { useWorkspaceNavigation, orderedWorkspaceIds } from '../stores/navigation';
import { useWorkspaceStore as useSessionStore } from '../stores/workspace';
import { useUiStore } from '../stores/ui';
import { fitWorkspacePanes, workspacePaneCells, type WorkspacePaneLayout, type WorkspaceResource } from '../model/workspaceResources';
import { closeWorkspaceResource } from '../services/workspaceResources';
import { focusUnifiedResource } from '../services/unifiedWorkspace';
import { openWorkspaceFile } from '../services/workspaceActions';
import WorkspaceResourceSwitcher from './WorkspaceResourceSwitcher';
import SshResourcesAction from './SshResourcesAction';
import { firstLeaf } from '../model/windowLayout';

function resourceIcon(resource: WorkspaceResource) {
  if (resource.kind === 'conversation') return <AppMark size={16} />;
  if (resource.kind === 'agent') { const Mark = harnessMark(resource.title); return <Mark size={16} />; }
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
  const body = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; direction?: 'row' | 'col' } | null>(null);
  const previousIds = useRef(new Set(ids));
  useEffect(() => {
    if (!active) { previousIds.current = new Set(ids); return; }
    state.reconcile(ids);
    const added = ids.filter(id => !previousIds.current.has(id)); previousIds.current = new Set(ids);
    if (added.length) focusUnifiedResource(added[added.length - 1]!);
  }, [active, key]);
  useEffect(() => {
    const element = body.current; if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientWidth > 0 && element.clientHeight > 0) setSize({ width: element.clientWidth, height: element.clientHeight }); }); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fitted = useMemo(() => state.layout && fitWorkspacePanes(state.layout, size.width, size.height), [state.layout, size]);
  const layout = fitted?.layout;
  const cells = layout ? workspacePaneCells(layout) : [];
  const focused = cells.find(cell => cell.id === state.focused) ?? cells[0];
  const placed = new Set(cells.map(cell => cell.resourceId));
  const items = orderedWorkspaceIds(ids, state.order).flatMap(id => {
    const resource = resources.find(item => item.id === id);
    return resource ? [{ id, label: `${resource.title}${resource.dirty ? ' •' : ''}`, tip: resource.title, closeLabel: t('Close this tab'), icon: resourceIcon(resource) }] : [];
  });
  const newItem = (kind: 'terminal' | 'document' | 'conversation') => {
    if (kind === 'terminal') useSessionStore.getState().addTab();
    else if (kind === 'document') newEditorFile();
    else { useAiWorkspace.getState().openNative(useChatStore.getState().createConversation()); useSessionStore.getState().openHarnessTab(); }
    useWorkspaceNavigation.getState().selectArea('unified');
  };
  const anchor = (trigger: HTMLButtonElement, direction?: 'row' | 'col') => {
    const box = trigger.getBoundingClientRect(); setMenu({ anchor: { x: box.right, y: box.bottom + 4, trigger, align: 'end' }, direction });
  };
  const split = (id: string, direction: 'row' | 'col') => { state.split(id, direction); focusUnifiedResource(id); };
  const close = (id: string) => { const resource = resources.find(item => item.id === id); if (resource) closeWorkspaceResource(resource); useWorkspaceNavigation.getState().selectArea('unified'); };
  return <section className="unified-workspace" data-testid="unified-workspace" style={{ display: active ? 'flex' : 'none' }} inert={!visible}>
    <WorkspaceHeader active={visible}><FolderTabs label={t('All workspace tabs')} listId="unified-resources" items={items} selected={focused?.resourceId ?? ''}
      onSelect={focusUnifiedResource} onClose={close} onMove={(...args) => state.move(ids, ...args)} menuItems={[
        { label: t('New terminal'), onClick: () => newItem('terminal') }, { label: t('New file'), onClick: () => newItem('document') },
        { label: t('New conversation'), onClick: () => newItem('conversation') },
        { label: t('Single pane'), disabled: cells.length < 2, onClick: state.single },
      ]} toolbar={<>
        <WorkspaceResourceSwitcher />
        {resources.find(resource => resource.id === focused?.resourceId)?.kind === 'terminal' && <SshResourcesAction />}
        <IconButton compact aria-label={t('All history')} data-tip={t('All history')} onClick={() => useWorkspaceNavigation.getState().selectHistory('all')}><History size={16} /></IconButton>
        <IconButton compact aria-label={t('Split right')} data-tip={t('Split right')} disabled={cells.length >= 4 || !resources.some(resource => !placed.has(resource.id))} onClick={event => anchor(event.currentTarget, 'row')}><Columns2 size={16} /></IconButton>
        <IconButton compact aria-label={t('Split below')} data-tip={t('Split below')} disabled={cells.length >= 4 || !resources.some(resource => !placed.has(resource.id))} onClick={event => anchor(event.currentTarget, 'col')}><Columns2 size={16} style={{ transform: 'rotate(90deg)' }} /></IconButton>
        <IconButton compact aria-label={t('Open file')} data-tip={t('Open file')} onClick={() => void openWorkspaceFile()}><FolderOpen size={16} /></IconButton>
        <IconButton compact aria-label={t('New workspace tab')} data-tip={t('New workspace tab')} onClick={event => anchor(event.currentTarget)}><Plus size={16} /></IconButton>
      </>} /></WorkspaceHeader>
    <div className="unified-pane-canvas" ref={body}>
      <div className="unified-pane-layout" ref={canvas} style={{ height: fitted?.height ?? size.height }}>
      {cells.map(cell => { const resource = resources.find(item => item.id === cell.resourceId); return resource && <MixedPane key={resource.id} resource={resource} cell={cell} focused={cell.id === state.focused} visible={visible} multiple={cells.length > 1} onRemove={() => state.removePane(cell.id)} />; })}
      {layout && <MixedDividers layout={layout} container={canvas} />}
      {!cells.length && <div className="workspace-empty"><FileCode size={32} /><p>{t('Open terminals, files and conversations together.')}</p><OutlineButton onClick={() => newItem('document')}>{t('New file')}</OutlineButton></div>}
      </div>
    </div>
    {menu && <ContextMenu anchor={menu.anchor} label={t(menu.direction ? 'Choose a tab to split' : 'New workspace tab')} itemRole="menuitem" onClose={() => setMenu(null)} items={menu.direction
      ? resources.filter(resource => !placed.has(resource.id)).map(resource => ({ label: resource.title, onClick: () => split(resource.id, menu.direction!) }))
      : [{ label: t('New terminal'), onClick: () => newItem('terminal') }, { label: t('New file'), onClick: () => newItem('document') }, { label: t('New conversation'), onClick: () => newItem('conversation') }]} />}
  </section>;
}

function MixedPane({ resource, cell, focused, visible, multiple, onRemove }: { resource: WorkspaceResource; cell: ReturnType<typeof workspacePaneCells>[number]; focused: boolean; visible: boolean; multiple: boolean; onRemove: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current; if (!element || !visible || focused) return;
    const focus = () => focusUnifiedResource(resource.id);
    element.addEventListener('pointerdown', focus, true); element.addEventListener('focusin', focus, true);
    return () => { element.removeEventListener('pointerdown', focus, true); element.removeEventListener('focusin', focus, true); };
  }, [resource.id, visible, focused]);
  return <div ref={host} className="unified-pane" data-resource-id={resource.id} data-focused={focused || undefined} style={{ left: `${cell.rect.x * 100}%`, top: `${cell.rect.y * 100}%`, width: `${cell.rect.w * 100}%`, height: `${cell.rect.h * 100}%` }}>
    {multiple && <div className="unified-pane-caption"><span>{resourceIcon(resource)}{resource.title}</span><IconButton compact aria-label={t('Remove pane')} data-tip={t('Remove pane')} onClick={onRemove}><X size={14} /></IconButton></div>}
    <ResourceContentSlot id={resource.id} visible={visible} focused={focused} />
  </div>;
}

function MixedDividers({ layout, container }: { layout: WorkspacePaneLayout; container: React.RefObject<HTMLDivElement | null> }) {
  const result: ReactNode[] = [];
  const visit = (node: WorkspacePaneLayout, rect = { x: 0, y: 0, w: 1, h: 1 }) => {
    if (node.type === 'pane') return;
    const row = node.direction === 'row'; const first = workspacePaneCells(node.first)[0]!.id; const second = workspacePaneCells(node.second)[0]!.id;
    result.push(<div key={`${first}:${second}`} className="unified-pane-divider" style={{ left: `${(rect.x + (row ? rect.w * node.ratio : 0)) * 100}%`, top: `${(rect.y + (row ? 0 : rect.h * node.ratio)) * 100}%`, width: row ? 0 : `${rect.w * 100}%`, height: row ? `${rect.h * 100}%` : 0 }}>
      <ResizeHandle axis={row ? 'x' : 'y'} label={t('Resize workspace panes')} valueNow={Math.round(node.ratio * 100)} valueMin={20} valueMax={80} onReset={() => useUnifiedWorkspace.getState().ratio(first, second, 0.5)} onDelta={delta => {
        const bounds = container.current?.getBoundingClientRect(); if (!bounds) return;
        const size = row ? bounds.width * rect.w : bounds.height * rect.h;
        if (size > 0) useUnifiedWorkspace.getState().ratio(first, second, node.ratio + delta / size);
      }} />
    </div>);
    visit(node.first, { ...rect, w: row ? rect.w * node.ratio : rect.w, h: row ? rect.h : rect.h * node.ratio });
    visit(node.second, { x: row ? rect.x + rect.w * node.ratio : rect.x, y: row ? rect.y : rect.y + rect.h * node.ratio, w: row ? rect.w * (1 - node.ratio) : rect.w, h: row ? rect.h : rect.h * (1 - node.ratio) });
  };
  visit(layout); return result;
}
