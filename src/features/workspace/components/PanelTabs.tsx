import { TextInput } from '@ui/TextInput';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { iconSizes,
  Plus, History, Bot, Search, ChevronDown,
 } from '@ui/icons';
import { useSessionStore, isSessionTab, firstTerminalOf, terminalsOf, useTabDisplayTitle, tabIconKey, tabIconColor, type Tab, type TabGroup } from '@features/workspace';
import { useIconColorStore } from '@config/iconColors';
import { HistoryColorChoices } from '@ui/HistoryColorPalette';
import { regenerateTitle } from '@features/agent/services/title';
import { useToastStore } from '@ui/Toast';
import { IconBtn } from '@ui/UiBtn';
import type { ShellType } from '@platform/shells';
import { useDefaultShellType } from '../hooks/useDefaultShellType';
import NewTabModal from '@features/workspace/components/NewTabModal';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/ContextMenu';
import { FolderTabContent } from '@ui/FolderTabs';
import EditorActions from '@ui/EditorActions';
import { useHorizontalWheel } from '@ui/hooks/useHorizontalWheel';
import { useActiveTabVisibility } from '@ui/hooks/useActiveTabVisibility';
import { historyGroupColor } from '@ui/historyGroupColor';
import { useWorkspaceNavigation } from '../stores/navigation';
import WorkspaceHeader from '@ui/WorkspaceHeader';
import { SshIcon, shellIconFor } from '@ui/shellIcons';
import {
  ListReorderPlaceholder, ListReorderPreview, ListReorderZonePlaceholder,
  useListReorder, useListReorderDrag, type ListReorderDrag, type ListReorderTarget,
} from '@ui/listReorder';
import { t } from '@i18n';
import type { GroupingProposal } from '@features/agent/services/autoGrouping';
import { useToolWindow } from '@ui/hooks/useToolWindow';
import { applySessionGrouping } from '../services/autoGrouping';

/** Terminal navigation shares document tab styling and the common reorder placeholders. */

/** One reorder list spans group headers and every tab row. */
const LIST_ID = 'session-tabs';
/** Zone id of the loose (ungrouped) area. */
const UNGROUPED_ZONE = 'ungrouped';

export default function PanelTabs({ active = true }: { active?: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  useHorizontalWheel(strip, true);
  const [searchOpen, setSearchOpen] = useState(false);
  const defaultShellType = useDefaultShellType();
  const tabs = useSessionStore((s) => s.tabs);
  const iconColors = useIconColorStore(state => state.colors);
  const activeId = useSessionStore((s) => s.activeId);
  const groups = useSessionStore((s) => s.groups);
  const activate = useSessionStore((s) => s.activate);
  const closeTab = useSessionStore((s) => s.closeTab);
  const renameTab = useSessionStore((s) => s.renameTab);
  const duplicateTab = useSessionStore((s) => s.duplicateTab);
  const openHistoryTab = useSessionStore((s) => s.openHistoryTab);
  const loadGroups = useSessionStore((s) => s.loadGroups);
  const createGroupForTab = useSessionStore((s) => s.createGroupForTab);
  const renameGroup = useSessionStore((s) => s.renameGroup);
  const archiveGroup = useSessionStore((s) => s.archiveGroup);
  const deleteGroup = useSessionStore((s) => s.deleteGroup);
  const toggleGroupCollapse = useSessionStore((s) => s.toggleGroupCollapse);

  const [query, setQuery] = useState('');
  const openGrouping = useToolWindow({ key: 'grouping:session-tabs', kind: 'grouping', title: t('AI auto-group'),
    input: { kind: 'session tabs', items: tabs.filter(isSessionTab).map(tab => ({ id: tab.id, label: tab.title,
      detail: terminalsOf(tab).map(term => `${term.kind} · ${term.cwd ?? ''}`).join('\n') })) },
    onError: reason => { useToastStore.getState().addToast(String(reason), 'error'); },
    onAction: async (action: { type: 'apply'; groups: GroupingProposal[] }) => applySessionGrouping(action.groups) });
  const [panelMenu, setPanelMenu] = useState<MenuAnchor | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalGroupId, setModalGroupId] = useState<string | undefined>(undefined);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useActiveTabVisibility(strip, '[data-active="true"], [data-header-selected="true"]', `${activeId}:${tabs.length}:${JSON.stringify(groups)}`);

  function commitDrop(drag: ListReorderDrag, target: ListReorderTarget | null) {
    const ws = useSessionStore.getState();
    if (drag.kind === 'group') {
      if (!target?.itemId) return;
      const over = ws.groups.findIndex((g) => g.id === target.itemId);
      if (over < 0) return;
      const from = ws.groups.findIndex((g) => g.id === drag.id);
      let to = over + (target.after ? 1 : 0);
      if (from < to) to -= 1;
      if (to !== from) ws.moveGroup(drag.id, to);
      return;
    }
    // Tab drag
    const tab = ws.tabs.find((t) => t.id === drag.id);
    if (!tab) return;
    const overTab = target?.itemId
      ? ws.tabs.find((t) => t.id === target.itemId)
      : undefined;
    if (overTab) {
      const groupId = isSessionTab(overTab) ? overTab.groupId ?? null : null;
      if (!isSessionTab(tab) && groupId !== null) return;
      const scope = ws.tabs.filter((t) => t.id !== drag.id && (isSessionTab(t) ? (t.groupId ?? null) === groupId : groupId === null));
      const idx = scope.findIndex((t) => t.id === overTab.id) + (target?.after ? 1 : 0);
      ws.moveTab(drag.id, groupId, Math.max(0, idx));
      return;
    }
    if (target?.zoneId) {
      const groupId = target.zoneId === UNGROUPED_ZONE ? null : target.zoneId;
      if (!isSessionTab(tab) && groupId !== null) return;
      const scope = ws.tabs.filter((t) => t.id !== drag.id && (isSessionTab(t) ? (t.groupId ?? null) === groupId : groupId === null));
      ws.moveTab(drag.id, groupId, scope.length);
      return;
    }
    // Dropped outside the list: a grouped tab falls back to the ungrouped end.
    if (isSessionTab(tab) && tab.groupId) {
      const scope = ws.tabs.filter((t) => t.id !== drag.id && (!isSessionTab(t) || !t.groupId));
      ws.moveTab(drag.id, null, scope.length);
    }
  }

  const startDrag = useListReorderDrag({ listId: LIST_ID, axis: 'horizontal', grouped: true, onDrop: commitDrop,
    accepts: (dragKind, itemKind) => dragKind === 'group' ? itemKind === 'group'
      : itemKind === 'loose-tab' || (dragKind === 'tab' && itemKind === 'tab'),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terminalTabs = tabs.filter(tab => tab.kind === 'session' || tab.kind === 'history');
    if (!q) return terminalTabs;
    return terminalTabs.filter((t) => t.title.toLowerCase().includes(q));
  }, [tabs, query]);

  const groupTabs = (gid: string) => filtered.filter((t) => isSessionTab(t) && t.groupId === gid);
  const ungroupedTabs = filtered.filter((tab) => !isSessionTab(tab) || !tab.groupId);
  // The dragged row does not participate in the final insertion boundary.
  const draggedTabId = useListReorder((s) => (s.drag && s.drag.kind !== 'group' ? s.drag.id : undefined));
  const remainingUngrouped = ungroupedTabs.filter((tab) => tab.id !== draggedTabId);
  const lastUngroupedId = remainingUngrouped[remainingUngrouped.length - 1]?.id;

  const ctxTab = ctxMenu ? tabs.find((t) => t.id === ctxMenu.tabId) : undefined;
  const ctxItems: ContextMenuItem[] = ctxMenu && ctxTab
    ? [
        ...(isSessionTab(ctxTab) && !ctxTab.groupId ? [{
          label: t('Create tab group'), group: 'organize' as const,
          onClick: () => {
            // Creating a group immediately focuses its name input.
            void createGroupForTab(ctxTab.id).then((gid) => {
              if (!gid) return;
              setRenamingGroupId(gid);
            });
          },
        }] : []),
        // Grouped tabs also offer an explicit way back to the loose area.
        ...(isSessionTab(ctxTab) && ctxTab.groupId ? [{
          label: t('Remove from tab group'), group: 'organize' as const,
          onClick: () => {
            const scope = tabs.filter((t) => t.id !== ctxTab.id && (!isSessionTab(t) || !t.groupId));
            useSessionStore.getState().moveTab(ctxTab.id, null, scope.length);
          },
        }] : []),
        ...(isSessionTab(ctxTab) ? [
          { label: t('Rename tab'), group: 'edit' as const, onClick: () => { setEditId(ctxTab.id); setEditTitle(ctxTab.title); } },
          { label: t('Regenerate tab title'), group: 'edit' as const, onClick: () => {
            useToastStore.getState().addToast(t('Regenerating tab title…'), 'info');
            void regenerateTitle(ctxTab.id).then((ok) => {
              if (ok) useToastStore.getState().addToast(t('Tab title updated'), 'success');
            });
          } },
          { label: t('Duplicate session'), group: 'primary' as const, onClick: () => duplicateTab(ctxTab.id) },
        ] : []),
        { label: t('AI auto-group'), group: 'organize', disabled: !tabs.some(isSessionTab), onClick: openGrouping },
        { label: t('Close this tab'), danger: true, onClick: () => closeTab(ctxTab.id) },
      ]
    : [];

  return (
    <WorkspaceHeader active={active}><div className="folder-header terminal-instance-header">
      <div className="folder-more"><EditorActions label={t('More terminal actions')} items={[
        { label: t('Create terminal'), onClick: () => { useSessionStore.getState().addTab(); } },
        { label: t('New terminal options'), onClick: () => { setModalGroupId(undefined); setModalOpen(true); } },
        { label: t('Session history'), onClick: openHistoryTab },
        { label: t('ACP'), onClick: () => useSessionStore.getState().openHarnessTab() },
        { label: t('Search session titles…'), onClick: () => setSearchOpen(true) },
        { label: t('AI auto-group'), disabled: !tabs.some(isSessionTab), onClick: openGrouping },
      ]} /></div>
      <div className="folder-actions terminal-tab-tools">
        <IconBtn title={t('Search session titles…')} data-testid="tab-search-toggle" onClick={() => { setSearchOpen(!searchOpen); setQuery(''); }}><Search size={iconSizes.control} /></IconBtn>
        {searchOpen && <TextInput variant="field" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search session titles…')} data-testid="tab-search" className="terminal-tab-search" />}
        <span className="folder-action-secondary terminal-secondary-actions"><IconBtn title={t('Session history')} data-testid="tab-history-btn" onClick={openHistoryTab}>
          <History size={iconSizes.control} />
        </IconBtn>
        <IconBtn title={t('ACP')} data-testid="tab-acp-btn" onClick={() => useSessionStore.getState().openHarnessTab()}>
          <Bot size={iconSizes.control} />
        </IconBtn>
        </span>
        <span className="terminal-new-controls">
          <IconBtn title={t('Create terminal')} data-testid="tab-new-default" onClick={() => { useSessionStore.getState().addTab(); }}><Plus size={iconSizes.control} /></IconBtn>
          <IconBtn title={t('New terminal options')} data-testid="tab-new-btn" aria-haspopup="dialog" onClick={() => { setModalGroupId(undefined); setModalOpen(true); }}><ChevronDown size={iconSizes.control} /></IconBtn>
        </span>
      </div>

      {/* Group chips and instance tabs share one reorder list. */}
      <div ref={strip} data-reorder-list={LIST_ID} className="folder-tab-list terminal-tab-list" role="tablist" aria-label={t('Terminal sessions')} onContextMenu={event => {
        // The webview policy cancels every native context menu before React runs, so
        // `defaultPrevented` is always true here; nested menus stop propagation instead.
        event.preventDefault();
        setPanelMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget });
      }}
        >
        {groups.map((g) => (
          <Fragment key={g.id}>
            <ListReorderPlaceholder listId={LIST_ID} itemId={g.id} />
            <GroupSection
              defaultShellType={defaultShellType}
              group={g}
              tabs={groupTabs(g.id)}
              activeId={activeId}
              editId={editId}
              editTitle={editTitle}
              setEditTitle={setEditTitle}
              renamingGroupId={renamingGroupId}
              onActivate={activate}
              onClose={closeTab}
              onStartEdit={(id, title) => { setEditId(id); setEditTitle(title); }}
              onCommitEdit={() => { if (editId) renameTab(editId, editTitle); setEditId(null); }}
              onCancelEdit={() => setEditId(null)}
              onToggleCollapse={() => toggleGroupCollapse(g.id)}
              onRenameGroup={title => renameGroup(g.id, title)}
              onCancelRenameGroup={() => setRenamingGroupId(null)}
              onDeleteGroup={() => {
                const hasTabs = tabs.some(tab => isSessionTab(tab) && tab.groupId === g.id);
                if (!hasTabs) { void deleteGroup(g.id, false); return; }
                const ok = window.confirm(t('Archive group "{{name}}"? Its tabs will close and move to session history.', { name: g.title }));
                if (!ok) return;
                void archiveGroup(g.id);
              }}
              onPointerDownTab={(event, tabId) => startDrag(event, { id: tabId, kind: 'tab' })}
              onPointerDownGroup={(event) => startDrag(event, { id: g.id, kind: 'group' })}
              onContextMenuTab={(e, tabId) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, tabId }); }}
              onAddTab={() => { setModalGroupId(g.id); setModalOpen(true); }}
              onAutoGroup={openGrouping}
            />
            <ListReorderPlaceholder listId={LIST_ID} itemId={g.id} after />
            {/* Empty and collapsed groups accept appends at the group boundary. */}
            {(g.collapsed || groupTabs(g.id).length === 0) && (
              <ListReorderZonePlaceholder listId={LIST_ID} zoneId={g.id} />
            )}
          </Fragment>
        ))}

        {/* The ungrouped drop zone owns the remaining space, even with no session rows. */}
        {(ungroupedTabs.length > 0 || groups.length > 0) && (
          <div
            data-reorder-zone={UNGROUPED_ZONE}
            data-reorder-kind="loose-tab"
            className="terminal-ungrouped-tabs"
          >
            {ungroupedTabs.map((t) => (
              <Fragment key={t.id}>
                <ListReorderPlaceholder listId={LIST_ID} itemId={t.id} />
                <TabRow
                  defaultShellType={defaultShellType}
                  tab={t}
                  active={t.id === activeId}
                  editing={editId === t.id}
                  editTitle={editTitle}
                  setEditTitle={setEditTitle}
                  onActivate={() => activate(t.id)}
                  onClose={() => closeTab(t.id)}
                  onStartEdit={() => { if (isSessionTab(t)) { setEditId(t.id); setEditTitle(t.title); } }}
                  onCommitEdit={() => { renameTab(t.id, editTitle); setEditId(null); }}
                  onCancelEdit={() => setEditId(null)}
                  onPointerDown={(event) => startDrag(event, { id: t.id, kind: isSessionTab(t) ? 'tab' : 'page' })}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, tabId: t.id }); }}
                />
              </Fragment>
            ))}
            {lastUngroupedId
              ? <ListReorderPlaceholder listId={LIST_ID} itemId={lastUngroupedId} after />
              : <ListReorderZonePlaceholder listId={LIST_ID} zoneId={UNGROUPED_ZONE} />}
          </div>
        )}

        {filtered.length === 0 && query.trim().length > 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>{t('No matching terminal sessions')}</div>
        )}
      </div>

      {/* Instance actions reuse the shared context menu. */}
      {ctxMenu && ctxItems.length > 0 && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={ctxItems}
          footer={ctxTab && isSessionTab(ctxTab) && <>
            <div className="history-menu-color-label">{t('Icon color')}</div>
            <HistoryColorChoices menu label={t('Icon color')} value={iconColors[tabIconKey(ctxTab)] ?? null}
              testId="tab-icon-color" onSelect={color => {
                useIconColorStore.getState().setColor(tabIconKey(ctxTab), color); setCtxMenu(null);
              }} />
          </>}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <ListReorderPreview listId={LIST_ID} variant="item">
        {(drag) => {
          if (drag.kind === 'group') {
            const group = groups.find(item => item.id === drag.id);
            if (!group) return null;
            const color = useWorkspaceNavigation.getState().groupColors[group.id] ?? historyGroupColor(group.id);
            return <div className="terminal-tab-group terminal-group-preview" style={{ '--terminal-group-color': color === 'neutral' ? 'var(--text-secondary)' : `var(--group-${color})` } as React.CSSProperties}>
              <span className="terminal-group-chip">{group.title}</span>
              {!group.collapsed && groupTabs(group.id).map(tab => <TerminalTabPreview key={tab.id} tab={tab} active={tab.id === activeId} defaultShellType={defaultShellType} />)}
            </div>;
          }
          const tab = tabs.find(item => item.id === drag.id);
          return tab ? <TerminalTabPreview tab={tab} active={tab.id === activeId} defaultShellType={defaultShellType} /> : null;
        }}
      </ListReorderPreview>

      <NewTabModal open={modalOpen} groupId={modalGroupId} onClose={() => setModalOpen(false)} />
      {panelMenu && <ContextMenu anchor={panelMenu} onClose={() => setPanelMenu(null)} items={[
        { label: t('AI auto-group'), disabled: !tabs.some(isSessionTab), onClick: openGrouping },
      ]} />}
    </div></WorkspaceHeader>
  );
}

function TerminalTabPreview({ tab, active, defaultShellType }: { tab: Tab; active: boolean; defaultShellType?: ShellType }) {
  const title = useTabDisplayTitle(tab);
  const colors = useIconColorStore(state => state.colors);
  const first = firstTerminalOf(tab);
  const Icon = tab.kind === 'history' ? History : first?.kind === 'ssh' ? SshIcon : shellIconFor(first?.kind === 'local' ? first.shellType ?? defaultShellType : undefined);
  return <div className="folder-tab folder-tab-preview terminal-instance-tab" data-active={active}>
    <FolderTabContent selected={active} item={{ id: tab.id, label: title, tip: title, closeLabel: t('Close this tab'), icon: <Icon size={iconSizes.compact} style={{ color: tabIconColor(tab, colors) }} /> }} />
  </div>;
}

/** A colored group chip owns contiguous terminal tabs and their shared drop zone. */
function GroupSection(props: {
  defaultShellType?: ShellType;
  group: TabGroup;
  tabs: Tab[];
  activeId: string;
  editId: string | null;
  editTitle: string;
  setEditTitle: (value: string) => void;
  renamingGroupId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onToggleCollapse: () => void;
  onRenameGroup: (title: string) => void;
  onCancelRenameGroup: () => void;
  onDeleteGroup: () => void;
  onPointerDownTab: (event: React.PointerEvent<HTMLElement>, id: string) => void;
  onPointerDownGroup: (event: React.PointerEvent<HTMLElement>) => void;
  onContextMenuTab: (event: React.MouseEvent, id: string) => void;
  onAddTab: () => void;
  onAutoGroup: () => void;
}) {
  const { group, tabs, activeId } = props;
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [name, setName] = useState(group.title);
  const header = useRef<HTMLDivElement>(null);
  const openMenu = (anchor: MenuAnchor) => { setName(group.title); setMenu(anchor); };
  const closeMenu = () => {
    const title = name.trim();
    if (title && title !== group.title) props.onRenameGroup(title);
    setMenu(null);
  };
  useEffect(() => {
    if (props.renamingGroupId !== group.id || !header.current) return;
    const trigger = header.current; const bounds = trigger.getBoundingClientRect();
    setName(group.title); setMenu({ x: bounds.left, y: bounds.bottom, trigger });
    props.onCancelRenameGroup();
  }, [props.renamingGroupId, group.id, group.title, props.onCancelRenameGroup]);
  const colorOverride = useWorkspaceNavigation(state => state.groupColors[group.id]);
  const color = colorOverride ?? historyGroupColor(group.id);
  const empty = useSessionStore(state => !state.tabs.some(tab => isSessionTab(tab) && tab.groupId === group.id));
  const active = tabs.some(tab => tab.id === activeId);
  const dragging = useListReorder(state => state.drag?.listId === LIST_ID && state.drag.id === group.id);
  const draggedTab = useListReorder(state => state.drag?.listId === LIST_ID ? state.drag.id : undefined);
  const remaining = tabs.filter(tab => tab.id !== draggedTab);
  const last = remaining[remaining.length - 1]?.id;
  return <div className="terminal-tab-group" data-group-color={color} style={{ '--terminal-group-color': color === 'neutral' ? 'var(--text-secondary)' : `var(--group-${color})` } as React.CSSProperties}>
    <div className="tab-group-container" data-reorder-container="" data-reorder-dragging={dragging ? 'true' : undefined}
      data-group-id={group.id} data-group-active={active} data-reorder-zone={group.id} data-reorder-kind="tab">
      <div ref={header} className="folder-tab tab-group-header" data-group-card="true" data-reorder-measure="container" data-group-header-id={group.id}
        data-header-selected={group.collapsed && active ? 'true' : 'false'}
        data-testid={`group-header-${group.id}`} data-reorder-item={group.id} data-reorder-kind="group"
        data-reorder-dragging={dragging ? 'true' : undefined} tabIndex={0} role="button" aria-expanded={!group.collapsed} aria-label={group.title}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onToggleCollapse(); }
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
            openMenu({ x: rect.left, y: rect.bottom, trigger: event.currentTarget });
          }
        }}
        onClick={props.onToggleCollapse}
        onPointerDown={props.onPointerDownGroup} data-tip={t('Collapse or expand group · Right-click to rename · Drag to reorder')}>
        <span className="terminal-group-chip" data-testid={`group-title-${group.id}`}>
            <span>{group.title}</span>
            {group.collapsed && <span data-testid={`group-count-${group.id}`}>{tabs.length}</span>}
          </span>
      </div>
      {!group.collapsed && tabs.map(tab => <Fragment key={tab.id}>
        <ListReorderPlaceholder listId={LIST_ID} itemId={tab.id} />
        <TabRow defaultShellType={props.defaultShellType} tab={tab} active={tab.id === activeId}
          editing={props.editId === tab.id} editTitle={props.editTitle} setEditTitle={props.setEditTitle}
          onActivate={() => props.onActivate(tab.id)} onClose={() => props.onClose(tab.id)}
          onStartEdit={() => props.onStartEdit(tab.id, tab.title)} onCommitEdit={props.onCommitEdit} onCancelEdit={props.onCancelEdit}
          onPointerDown={event => props.onPointerDownTab(event, tab.id)} onContextMenu={event => props.onContextMenuTab(event, tab.id)} />
      </Fragment>)}
      {!group.collapsed && last && <ListReorderPlaceholder listId={LIST_ID} itemId={last} after />}
    </div>
    {menu && <ContextMenu anchor={menu} label={t('Group actions')} onClose={closeMenu} onCancel={() => setMenu(null)}
      header={<TextInput variant="field" aria-label={t('Group title')} value={name} onChange={event => setName(event.target.value)}
        onFocus={event => event.currentTarget.select()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); closeMenu(); menu.trigger?.focus(); } }} />} items={[
      { label: t('AI auto-group'), onClick: props.onAutoGroup },
      { label: t('Add terminal to group'), onClick: props.onAddTab },
      { label: t(group.collapsed ? 'Expand group' : 'Collapse group'), group: 'view', onClick: props.onToggleCollapse },
      { label: t(empty ? 'Delete empty group' : 'Archive tab group'), danger: empty, group: 'danger', onClick: props.onDeleteGroup },
    ]} footer={<>
      <div className="history-menu-color-label">{t('Group color')}</div>
      <HistoryColorChoices menu value={colorOverride ?? null} testId="terminal-group-color" onSelect={value => {
        menu.trigger?.focus();
        useWorkspaceNavigation.getState().setGroupColor(group.id, value); closeMenu();
      }} />
    </>} />}
  </div>;
}

function TabRow({
  tab, active, editing, editTitle, setEditTitle, defaultShellType,
  onActivate, onClose, onStartEdit, onCommitEdit, onCancelEdit, onPointerDown, onContextMenu,
}: {
  tab: Tab;
  defaultShellType?: ShellType;
  active: boolean;
  editing: boolean;
  editTitle: string;
  setEditTitle: (value: string) => void;
  onActivate: () => void;
  onClose: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const first = firstTerminalOf(tab);
  const terms = terminalsOf(tab);
  const displayTitle = useTabDisplayTitle(tab);
  const Icon = tab.kind === 'history' ? History
    : first?.kind === 'ssh' ? SshIcon
      : shellIconFor(first?.kind === 'local' ? first.shellType ?? defaultShellType : undefined);
  const colors = useIconColorStore(state => state.colors);
  const dragging = useListReorder(state => state.drag?.listId === LIST_ID && state.drag.id === tab.id);
  return <div className="folder-tab terminal-instance-tab" data-active={active} data-testid={`tab-row-${tab.id}`}
    data-tab-row-id={tab.id} data-tab-kind={tab.kind} data-tab-group={isSessionTab(tab) ? tab.groupId ?? '' : ''}
    data-reorder-item={tab.id} data-reorder-kind={isSessionTab(tab) && tab.groupId ? 'tab' : 'loose-tab'}
    data-reorder-dragging={dragging ? 'true' : undefined} onPointerDown={event => {
      if (event.button !== 0 || event.isPrimary === false || (event.target as Element).closest('[data-no-drag], input')) return;
      onPointerDown(event);
      // Preserve the session input focus when pressing a tab's nested button.
      event.preventDefault();
      if (!active) onActivate();
    }}
    onClick={event => { if (!(event.target as Element).closest('button, input')) onActivate(); }}
    onDoubleClick={onStartEdit} onContextMenu={onContextMenu}>
    {editing ? <TextInput className="inline-rename-input" autoFocus value={editTitle}
      onChange={event => setEditTitle(event.target.value)} onFocus={event => event.currentTarget.select()}
      onBlur={onCommitEdit} onKeyDown={event => {
        if (event.key === 'Enter') onCommitEdit(); else if (event.key === 'Escape') onCancelEdit();
      }} onClick={event => event.stopPropagation()} /> : <FolderTabContent item={{
        id: tab.id, label: displayTitle, tip: displayTitle,
        icon: <Icon size={iconSizes.compact} style={{ color: tabIconColor(tab, colors) ?? (isSessionTab(tab) ? undefined : active ? 'var(--text-primary)' : 'var(--text-secondary)') }} />,
        closeLabel: t('Close this tab'), closeTestId: `tab-close-${tab.id}`,
      }} selected={active} onSelect={onActivate} onClose={onClose} />}
    {tab.kind === 'session' && terms.length > 1 && <span className="terminal-split-count">{terms.length}</span>}
  </div>;
}
