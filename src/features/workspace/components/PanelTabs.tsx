import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { useWorkspaceStore, isSessionTab, terminalsOf } from '../stores/workspace';
import { resolveDisplayTitle } from '../model/sessionTitle';
import { terminalTabHandle } from '../model/terminalTabHandle';
import { leaf } from '../model/windowLayout';
import { useDefaultShellType } from '../hooks/useDefaultShellType';
import { useWorkspaceContainerTabs } from '../hooks/useWorkspaceContainerTabs';
import { useToolWindow } from '@ui/hooks/useToolWindow';
import { applySessionGrouping } from '../services/autoGrouping';
import type { GroupingProposal } from '@features/agent/services/autoGrouping';
import { regenerateTitle } from '@features/agent/services/title';
import { useToastStore } from '@ui/feedback/Toast';
import FolderTabs from '@ui/layout/FolderTabs';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import { TextInput } from '@ui/fields/TextInput';
import { IconBtn } from '@ui/actions/UiBtn';
import { Plus, History, Bot, Search, ChevronDown, X, iconSizes } from '@ui/icons';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import NewTabModal from './NewTabModal';
import SshResourcesAction from './SshResourcesAction';
import WorkspaceResourceSwitcher from './WorkspaceResourceSwitcher';
import { synchronizeWorkbench } from '../services/workbench';
import { useWorkbenchStore } from '../stores/workbench';
import { panesOf } from '../model/workbench';

/** Terminal-specific creation tools surround the shared container strip. */
export default function PanelTabs({ active = true }: { active?: boolean }) {
  const tabs = useWorkspaceStore(state => state.tabs);
  const activeId = useWorkspaceStore(state => state.activeId);
  const programTitles = useWorkspaceStore(state => state.programTitles);
  const groups = useWorkspaceStore(state => state.groups);
  const defaultShellType = useDefaultShellType();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [modal, setModal] = useState<{ groupId?: string } | null>(null);
  const [panelMenu, setPanelMenu] = useState<MenuAnchor | null>(null);
  const native = tabs.filter(isSessionTab);
  const containers = useWorkbenchStore(state => state.snapshot.tabs);
  const nativeOwner = (id: string) => {
    const direct = native.find(tab => tab.id === id);
    if (direct) return direct;
    const container = containers.find(tab => tab.id === id && tab.scope === 'terminal');
    if (!container) return undefined;
    const cells = panesOf(container);
    const focused = cells.find(pane => pane.id === container.focused) ?? cells[0];
    return native.find(tab => terminalsOf(tab).some(terminal => focused?.resourceId === `terminal:${terminal.id}`));
  };
  const resourceHandles = native.flatMap(tab => terminalsOf(tab).map(terminal => {
    const title = resolveDisplayTitle(tab.title, tab.titleSource, terminalsOf(tab).map(item => programTitles[item.id]).find(value => value?.trim()) ?? '');
    return { ...terminalTabHandle({ ...tab, layout: leaf(terminal) }, title, defaultShellType), id: `terminal:${terminal.id}` };
  }));
  const pages = tabs.filter(tab => tab.kind === 'history' || tab.kind === 'start');
  const strip = useWorkspaceContainerTabs('terminal', resourceHandles, undefined, pages.map(tab => tab.id));
  const handles = [...strip.handles.map(handle => {
    const tab = nativeOwner(handle.id);
    const container = containers.find(tab => tab.id === handle.id);
    const title = tab && (!container || panesOf(container).length === 1)
      ? resolveDisplayTitle(tab.title, tab.titleSource, terminalsOf(tab).map(item => programTitles[item.id]).find(value => value?.trim()) ?? '') : handle.label;
    return { ...handle, label: title, tip: title, closeTestId: `tab-close-${handle.id}`,
      dataAttributes: { ...handle.dataAttributes, 'data-testid': `tab-row-${handle.id}`, 'data-tab-row-id': handle.id, 'data-tab-kind': 'session' } };
  }), ...pages.map(tab => ({ ...terminalTabHandle(tab, tab.title, defaultShellType, `tab-close-${tab.id}`), surface: 'canvas' as const,
    dataAttributes: { 'data-testid': `tab-row-${tab.id}`, 'data-tab-row-id': tab.id, 'data-tab-kind': tab.kind, 'data-tab-group': '' } }))];
  useEffect(() => { void useWorkspaceStore.getState().loadGroups(); }, []);
  useEffect(() => { synchronizeWorkbench(); }, [tabs, groups]);
  const openGrouping = useToolWindow({ key: 'grouping:session-tabs', kind: 'grouping', title: t('AI auto-group'),
    input: { kind: 'session tabs', items: native.map(tab => ({ id: tab.id, label: tab.title, detail: terminalsOf(tab).map(term => `${term.kind} · ${term.cwd ?? ''}`).join('\n') })) },
    onError: reason => useToastStore.getState().addToast(String(reason), 'error'),
    onAction: async (action: { type: 'apply'; groups: GroupingProposal[] }) => applySessionGrouping(action.groups) });
  const create = () => { useWorkspaceStore.getState().addTab(); };
  const select = (id: string) => { if (pages.some(page => page.id === id)) useWorkspaceStore.getState().activate(id); else strip.onSelect(id); };
  const close = (id: string) => { if (pages.some(page => page.id === id)) useWorkspaceStore.getState().closeTab(id); else strip.onClose(id); };
  const filtered = handles.filter(handle => handle.label.toLowerCase().includes(query.trim().toLowerCase()));
  const grouping = strip.grouping && { ...strip.grouping, add: (id: string) => setModal({ groupId: id }) };
  const selected = native.some(tab => tab.id === activeId) ? strip.selected ?? activeId : activeId;
  return <WorkspaceHeader active={active}><FolderTabs items={filtered} selected={selected} label={t('Terminal sessions')} listId="session-tabs" className="terminal-tab-list"
    headerClassName="terminal-instance-header" grouping={grouping} onSelect={select} onClose={close} onMove={strip.onMove} onRename={strip.onRename}
    empty={query.trim() && <div className="search-empty-state">{t('No matching terminal sessions')}</div>}
    onBlankContext={setPanelMenu} menuLabel={t('More terminal actions')} menuItems={[
      ...(strip.tabActions?.(strip.selected ?? '') ?? []),
      { label: t('Create terminal'), onClick: create },
      { label: t('New terminal options'), onClick: () => setModal({}) },
      { label: t('Session history'), onClick: () => useWorkspaceStore.getState().openHistoryTab() },
      { label: t('ACP'), onClick: () => useWorkspaceStore.getState().openHarnessTab() },
      { label: t('Search session titles…'), onClick: () => setSearchOpen(true) },
      { label: t('AI auto-group'), disabled: !native.length, onClick: openGrouping },
    ]} tabActions={id => {
      const owner = nativeOwner(id);
      return [
        ...(strip.tabActions?.(id) ?? []),
        ...(owner ? [
          { label: t('Regenerate tab title'), onClick: () => { void regenerateTitle(owner.id); } },
          { label: t('Duplicate session'), onClick: () => useWorkspaceStore.getState().duplicateTab(owner.id) },
          { label: t('AI auto-group'), onClick: openGrouping },
        ] : []),
      ];
    }} toolbar={<>
      <WorkspaceResourceSwitcher /><SshResourcesAction />
      <IconBtn title={t('Search session titles…')} data-testid="tab-search-toggle" onClick={() => { setSearchOpen(!searchOpen); setQuery(''); }}><Search size={iconSizes.control} /></IconBtn>
      {searchOpen && <TextInput variant="field" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search session titles…')} data-testid="tab-search" className="terminal-tab-search" />}
      {query && <IconBtn title={t('Clear search')} onClick={() => setQuery('')}><X size={iconSizes.control} /></IconBtn>}
      <span className="folder-action-secondary terminal-secondary-actions">
        <IconBtn title={t('Session history')} data-testid="tab-history-btn" onClick={() => useWorkspaceStore.getState().openHistoryTab()}><History size={iconSizes.control} /></IconBtn>
        <IconBtn title={t('ACP')} data-testid="tab-acp-btn" onClick={() => useWorkspaceStore.getState().openHarnessTab()}><Bot size={iconSizes.control} /></IconBtn>
      </span>
      <span className="terminal-new-controls"><IconBtn title={t('Create terminal')} data-testid="tab-new-default" onClick={create}><Plus size={iconSizes.control} /></IconBtn>
        <IconBtn title={t('New terminal options')} data-testid="tab-new-btn" aria-haspopup="dialog" onClick={() => setModal({})}><ChevronDown size={iconSizes.control} /></IconBtn></span>
    </>} />
    <NewTabModal open={!!modal} groupId={modal?.groupId} onClose={() => setModal(null)} />
    {panelMenu && <ContextMenu anchor={panelMenu} onClose={() => setPanelMenu(null)} items={[{ label: t('AI auto-group'), disabled: !native.length, onClick: openGrouping }]} />}
  </WorkspaceHeader>;
}
