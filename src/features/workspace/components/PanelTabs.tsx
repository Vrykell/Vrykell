import { TextInput } from '@ui/fields/TextInput';
import InlineRenameInput from '@ui/fields/InlineRenameInput';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { iconSizes,
  Plus, History, Bot, Search, ChevronDown,
 } from '@ui/icons';
import { useSessionStore, isSessionTab, terminalsOf, useTabDisplayTitle, type Tab, type TabGroup } from '@features/workspace';
import { HistoryColorChoices } from '@ui/history/HistoryColorPalette';
import { regenerateTitle } from '@features/agent/services/title';
import { useToastStore } from '@ui/feedback/Toast';
import { IconBtn } from '@ui/actions/UiBtn';
import type { ShellType } from '@platform/shells';
import { useDefaultShellType } from '../hooks/useDefaultShellType';
import NewTabModal from '@features/workspace/components/NewTabModal';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import { FolderTabContent } from '@ui/layout/FolderTabs';
import EditorActions from '@ui/menus/EditorActions';
import { useHorizontalWheel } from '@ui/hooks/useHorizontalWheel';
import { useActiveTabVisibility } from '@ui/hooks/useActiveTabVisibility';
import { historyGroupColor } from '@ui/history/historyGroupColor';
import { orderedWorkspaceIds, useWorkspaceNavigation } from '../stores/navigation';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import { terminalTabHandle } from '../model/terminalTabHandle';
import {
  ListReorderPlaceholder, ListReorderPreview, ListReorderZonePlaceholder,
  useListReorder, useListReorderDrag, type ListReorderDrag, type ListReorderTarget,
} from '@ui/layout/listReorder';
import { t } from '@i18n';
import type { GroupingProposal } from '@features/agent/services/autoGrouping';
import { useToolWindow } from '@ui/hooks/useToolWindow';
import { applySessionGrouping } from '../services/autoGrouping';
import SshResourcesAction from './SshResourcesAction';
import WorkspaceResourceSwitcher from './WorkspaceResourceSwitcher';

/** Terminal navigation shares document tab styling and the common reorder placeholders. */

/** One reorder list spans group headers and every tab row. */
const LIST_ID = 'session-tabs';
/** Zone id of the loose (ungrouped) area. */
const UNGROUPED_ZONE = 'ungrouped';
const groupEntity = (id: string) => `group:${id}`;
const tabEntity = (id: string) => `tab:${id}`;
/** System pages share the AI strip's `page:` id space and never persist into the tab order. */
const pageEntity = (id: string) => `page:${id}`;

export default function PanelTabs({ active = true }: { active?: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  useHorizontalWheel(strip, true);
  const [searchOpen, setSearchOpen] = useState(false);
  const defaultShellType = useDefaultShellType();
  const tabs = useSessionStore((s) => s.tabs);
  const activeId = useSessionStore((s) => s.activeId);
  const groups = useSessionStore((s) => s.groups);
  const sessionLayoutOrder = useWorkspaceNavigation(state => state.sessionLayoutOrder);
  const activate = useSessionStore((s) => s.activate);
  const closeTab = useSessionStore((s) => s.closeTab);
  const renameTab = useSessionStore((s) => s.renameTab);
  const duplicateTab = useSessionStore((s) => s.duplicateTab);
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
  useActiveTabVisibility(strip, '[data-active="true"], [data-group-anchor="true"]', `${activeId}:${tabs.length}:${JSON.stringify(groups)}`);

  function commitDrop(drag: ListReorderDrag, target: ListReorderTarget | null) {
    const ws = useSessionStore.getState();
    if (drag.kind === 'group') {
      const overGroup = target?.itemId ? ws.groups.find(group => group.id === target.itemId) : undefined;
      const overTab = target?.itemId ? ws.tabs.find(tab => tab.id === target.itemId) : undefined;
      if (overGroup) {
        const groupOrder = ws.groups.map(group => group.id).filter(id => id !== drag.id);
        const over = groupOrder.indexOf(overGroup.id);
        useWorkspaceNavigation.getState().moveSessionLayoutItem(groupEntity(drag.id), groupEntity(overGroup.id), target?.after);
        groupOrder.splice(over + (target?.after ? 1 : 0), 0, drag.id);
        ws.moveGroup(drag.id, groupOrder.indexOf(drag.id));
      } else if (overTab) {
        useWorkspaceNavigation.getState().moveSessionLayoutItem(groupEntity(drag.id), isSessionTab(overTab) ? tabEntity(overTab.id) : pageEntity(overTab.id), target?.after);
      } else if (target?.zoneId === UNGROUPED_ZONE) {
        useWorkspaceNavigation.getState().moveSessionLayoutItem(groupEntity(drag.id));
      }
      return;
    }
    // Tab drag
    const tab = ws.tabs.find((t) => t.id === drag.id);
    if (!tab) return;
    const overTab = target?.itemId
      ? ws.tabs.find((t) => t.id === target.itemId)
      : undefined;
    const overGroup = target?.itemId ? ws.groups.find(group => group.id === target.itemId) : undefined;
    if (overGroup) {
      // A group-label target places the tab beside the whole group, never inside it;
      // joining happens through a member target or the collapsed-group dwell.
      const scope = ws.tabs.filter((t) => t.id !== drag.id && (!isSessionTab(t) || !t.groupId));
      ws.moveTab(drag.id, null, scope.length);
      useWorkspaceNavigation.getState().moveSessionLayoutItem(isSessionTab(tab) ? tabEntity(tab.id) : pageEntity(tab.id), groupEntity(overGroup.id), target?.after);
      return;
    }
    if (overTab) {
      const groupId = isSessionTab(overTab) ? overTab.groupId ?? null : null;
      if (!isSessionTab(tab) && groupId !== null) return;
      const scope = ws.tabs.filter((t) => t.id !== drag.id && (isSessionTab(t) ? (t.groupId ?? null) === groupId : groupId === null));
      const idx = scope.findIndex((t) => t.id === overTab.id) + (target?.after ? 1 : 0);
      ws.moveTab(drag.id, groupId, Math.max(0, idx));
      if (groupId === null) useWorkspaceNavigation.getState().moveSessionLayoutItem(isSessionTab(tab) ? tabEntity(tab.id) : pageEntity(tab.id),
        isSessionTab(overTab) ? tabEntity(overTab.id) : pageEntity(overTab.id), target?.after);
      return;
    }
    if (target?.zoneId) {
      const groupId = target.zoneId === UNGROUPED_ZONE ? null : target.zoneId;
      if (!isSessionTab(tab) && groupId !== null) return;
      const scope = ws.tabs.filter((t) => t.id !== drag.id && (isSessionTab(t) ? (t.groupId ?? null) === groupId : groupId === null));
      ws.moveTab(drag.id, groupId, scope.length);
      if (groupId === null) useWorkspaceNavigation.getState().moveSessionLayoutItem(isSessionTab(tab) ? tabEntity(tab.id) : pageEntity(tab.id));
      return;
    }
    // Dropped outside the list: a grouped tab falls back to the ungrouped end.
    if (isSessionTab(tab) && tab.groupId) {
      const scope = ws.tabs.filter((t) => t.id !== drag.id && (!isSessionTab(t) || !t.groupId));
      ws.moveTab(drag.id, null, scope.length);
    }
  }

  const startDrag = useListReorderDrag({ listId: LIST_ID, axis: 'horizontal', grouped: true, onDrop: commitDrop, endZoneId: UNGROUPED_ZONE,
    accepts: (dragKind, itemKind) => dragKind === 'group' ? itemKind === 'group' || itemKind === 'loose-tab'
      : dragKind === 'loose-tab' ? itemKind === 'group' || itemKind === 'loose-tab' || itemKind === 'tab'
        : itemKind === 'loose-tab' || itemKind === 'group' || (dragKind === 'tab' && itemKind === 'tab'),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terminalTabs = tabs.filter(tab => tab.kind === 'session' || tab.kind === 'history' || tab.kind === 'start');
    if (!q) return terminalTabs;
    return terminalTabs.filter((t) => t.title.toLowerCase().includes(q));
  }, [tabs, query]);

  const groupTabs = (gid: string) => filtered.filter((t) => isSessionTab(t) && t.groupId === gid);
  const ungroupedTabs = filtered.filter((tab) => !isSessionTab(tab) || !tab.groupId);
  const topLevelIds = [
    ...groups.map(group => groupEntity(group.id)),
    ...ungroupedTabs.map(tab => isSessionTab(tab) ? tabEntity(tab.id) : pageEntity(tab.id)),
  ];
  useEffect(() => {
    useWorkspaceNavigation.getState().reconcileSessionLayout(topLevelIds);
  }, [topLevelIds.join('|')]);
  const topLevel = orderedWorkspaceIds(topLevelIds, sessionLayoutOrder);
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
        { label: t('Session history'), onClick: () => useSessionStore.getState().openHistoryTab() },
        { label: t('ACP'), onClick: () => useSessionStore.getState().openHarnessTab() },
        { label: t('Search session titles…'), onClick: () => setSearchOpen(true) },
        { label: t('AI auto-group'), disabled: !tabs.some(isSessionTab), onClick: openGrouping },
      ]} /></div>
      <div className="folder-actions terminal-tab-tools">
        <WorkspaceResourceSwitcher />
        <SshResourcesAction />
        <IconBtn title={t('Search session titles…')} data-testid="tab-search-toggle" onClick={() => { setSearchOpen(!searchOpen); setQuery(''); }}><Search size={iconSizes.control} /></IconBtn>
        {searchOpen && <TextInput variant="field" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search session titles…')} data-testid="tab-search" className="terminal-tab-search" />}
        <span className="folder-action-secondary terminal-secondary-actions"><IconBtn title={t('Session history')} data-testid="tab-history-btn" onClick={() => useSessionStore.getState().openHistoryTab()}>
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
        {topLevel.map(entity => {
          const group = entity.startsWith('group:') ? groups.find(item => groupEntity(item.id) === entity) : undefined;
          if (group) return <Fragment key={entity}>
            <ListReorderPlaceholder listId={LIST_ID} itemId={group.id} />
            <GroupSection
              defaultShellType={defaultShellType}
              group={group}
              tabs={groupTabs(group.id)}
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
              onToggleCollapse={() => toggleGroupCollapse(group.id)}
              onRenameGroup={title => renameGroup(group.id, title)}
              onCancelRenameGroup={() => setRenamingGroupId(null)}
              onDeleteGroup={() => {
                const hasTabs = tabs.some(tab => isSessionTab(tab) && tab.groupId === group.id);
                if (!hasTabs) { void deleteGroup(group.id, false); return; }
                const ok = window.confirm(t('Archive group "{{name}}"? Its tabs will close and move to session history.', { name: group.title }));
                if (!ok) return;
                void archiveGroup(group.id);
              }}
              onPointerDownTab={(event, tabId) => startDrag(event, { id: tabId, kind: 'tab' })}
              onPointerDownGroup={(event) => startDrag(event, { id: group.id, kind: 'group' })}
              onContextMenuTab={(event, tabId) => { event.preventDefault(); event.stopPropagation(); setCtxMenu({ x: event.clientX, y: event.clientY, tabId }); }}
              onAddTab={() => { setModalGroupId(group.id); setModalOpen(true); }}
              onAutoGroup={openGrouping}
            />
            <ListReorderPlaceholder listId={LIST_ID} itemId={group.id} after />
            {(group.collapsed || groupTabs(group.id).length === 0) && <ListReorderZonePlaceholder listId={LIST_ID} zoneId={group.id} />}
          </Fragment>;
          const tab = entity.startsWith('tab:') ? ungroupedTabs.find(item => tabEntity(item.id) === entity)
            : entity.startsWith('page:') ? ungroupedTabs.find(item => pageEntity(item.id) === entity) : undefined;
          if (!tab) return null;
          return <Fragment key={entity}>
            <ListReorderPlaceholder listId={LIST_ID} itemId={tab.id} />
            <TabRow
              defaultShellType={defaultShellType}
              tab={tab}
              active={tab.id === activeId}
              editing={editId === tab.id}
              editTitle={editTitle}
              setEditTitle={setEditTitle}
              onActivate={() => activate(tab.id)}
              onClose={() => closeTab(tab.id)}
              onStartEdit={() => { if (isSessionTab(tab)) { setEditId(tab.id); setEditTitle(tab.title); } }}
              onCommitEdit={() => { renameTab(tab.id, editTitle); setEditId(null); }}
              onCancelEdit={() => setEditId(null)}
              onPointerDown={(event) => startDrag(event, { id: tab.id, kind: isSessionTab(tab) ? 'loose-tab' : 'page' })}
              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setCtxMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); }}
            />
            {lastUngroupedId === tab.id && <ListReorderPlaceholder listId={LIST_ID} itemId={tab.id} after />}
          </Fragment>;
        })}

        <div data-reorder-zone={UNGROUPED_ZONE} data-reorder-kind="loose-tab" className="terminal-ungrouped-tail">
          <ListReorderZonePlaceholder listId={LIST_ID} zoneId={UNGROUPED_ZONE} />
        </div>

        {filtered.length === 0 && query.trim().length > 0 && (
          <div className="search-empty-state">{t('No matching terminal sessions')}</div>
        )}
      </div>

      {/* Instance actions reuse the shared context menu. */}
      {ctxMenu && ctxItems.length > 0 && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <ListReorderPreview listId={LIST_ID} variant="item" className="terminal-group-reorder-preview">
        {(drag) => {
          if (drag.kind === 'group') {
            const group = groups.find(item => item.id === drag.id);
            if (!group) return null;
            const color = useWorkspaceNavigation.getState().groupColors[group.id] ?? historyGroupColor(group.id);
            return <div className="terminal-tab-group terminal-group-preview" data-group-card="true" data-group-collapsed="true" style={{ '--terminal-group-color': color === 'neutral' ? 'var(--text-secondary)' : `var(--group-${color})` } as React.CSSProperties}>
              <div className="folder-tab tab-group-header" data-tab-surface="true">
                <span className="terminal-group-chip">{group.title}</span>
              </div>
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
  const handle = terminalTabHandle(tab, title, defaultShellType);
  return <div className="folder-tab folder-tab-preview terminal-instance-tab" data-active={active} data-tab-surface={handle.capabilities.groupable ? undefined : 'canvas'}>
    <FolderTabContent selected={active} item={handle} />
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
  const { group, tabs } = props;
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [hovered, setHovered] = useState(false);
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
  const dragging = useListReorder(state => state.drag?.listId === LIST_ID && state.drag.id === group.id);
  const dropInto = useListReorder(state => state.dwellZoneId === group.id);
  const collapsedForDisplay = group.collapsed || dragging;
  // A collapsed group reads as a single tab: the dark tab surface appears only while it
  // owns the active tab, is hovered or is being dragged. Expanded groups keep their edge.
  const collapsedTabSurface = collapsedForDisplay && (dragging || hovered || tabs.some(tab => tab.id === props.activeId));
  const draggedTab = useListReorder(state => state.drag?.listId === LIST_ID ? state.drag.id : undefined);
  const remaining = tabs.filter(tab => tab.id !== draggedTab);
  const last = remaining[remaining.length - 1]?.id;
  const toggleCollapse = () => {
    const list = header.current?.closest<HTMLElement>('[data-reorder-list]');
    const before = header.current?.getBoundingClientRect().left;
    const scrollLeft = list?.scrollLeft;
    props.onToggleCollapse();
    if (!list || before === undefined || scrollLeft === undefined) return;
    requestAnimationFrame(() => {
      const after = header.current?.getBoundingClientRect().left;
      if (after === undefined) return;
      list.scrollLeft = scrollLeft + after - before;
    });
  };
  return <div className="terminal-tab-group" data-group-color={color} data-group-card="true" data-group-dragging={dragging ? 'true' : undefined}
    data-group-collapsed={collapsedForDisplay ? 'true' : undefined}
    data-drop-into={dropInto ? 'true' : undefined}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    style={{ '--terminal-group-color': color === 'neutral' ? 'var(--text-secondary)' : `var(--group-${color})` } as React.CSSProperties}>
    <div className="tab-group-container" data-reorder-container=""
      data-group-id={group.id} data-reorder-zone={group.id} data-reorder-kind="tab">
      <div ref={header} className="folder-tab tab-group-header" data-reorder-measure="container" data-group-header-id={group.id}
        data-tab-surface={collapsedTabSurface ? 'true' : undefined}
        data-group-anchor="true" data-testid={`group-header-${group.id}`} data-reorder-item={group.id} data-reorder-kind="group"
        tabIndex={0} role="button" aria-expanded={!group.collapsed} aria-label={group.title}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget }); }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onToggleCollapse(); }
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
            openMenu({ x: rect.left, y: rect.bottom, trigger: event.currentTarget });
          }
        }}
        onClick={toggleCollapse}
        onPointerDown={props.onPointerDownGroup} data-tip={t('Collapse or expand group · Right-click to rename · Drag to reorder')}>
        <span className="terminal-group-chip" data-testid={`group-title-${group.id}`}>
            <span>{group.title}</span>
          </span>
      </div>
      {!collapsedForDisplay && tabs.map(tab => <Fragment key={tab.id}>
        <ListReorderPlaceholder listId={LIST_ID} itemId={tab.id} />
        <TabRow defaultShellType={props.defaultShellType} tab={tab} active={tab.id === props.activeId}
          editing={props.editId === tab.id} editTitle={props.editTitle} setEditTitle={props.setEditTitle}
          onActivate={() => props.onActivate(tab.id)} onClose={() => props.onClose(tab.id)}
          onStartEdit={() => props.onStartEdit(tab.id, tab.title)} onCommitEdit={props.onCommitEdit} onCancelEdit={props.onCancelEdit}
          onPointerDown={event => props.onPointerDownTab(event, tab.id)} onContextMenu={event => props.onContextMenuTab(event, tab.id)} />
      </Fragment>)}
      {!collapsedForDisplay && last && <ListReorderPlaceholder listId={LIST_ID} itemId={last} after />}
    </div>
    {menu && <ContextMenu anchor={menu} label={t('Group actions')} onClose={closeMenu} onCancel={() => setMenu(null)}
      header={<InlineRenameInput variant="field" aria-label={t('Group title')} value={name} onChange={event => setName(event.target.value)}
        onFocus={event => event.currentTarget.select()} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); closeMenu(); menu.trigger?.focus(); } }} />} items={[
      { label: t('AI auto-group'), onClick: props.onAutoGroup },
      { label: t('Add terminal to group'), onClick: props.onAddTab },
      { label: t(group.collapsed ? 'Expand group' : 'Collapse group'), group: 'view', onClick: toggleCollapse },
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
  const displayTitle = useTabDisplayTitle(tab);
  const handle = terminalTabHandle(tab, displayTitle, defaultShellType, `tab-close-${tab.id}`);
  const groupId = isSessionTab(tab) ? tab.groupId ?? '' : '';
  const dragging = useListReorder(state => state.drag?.listId === LIST_ID && state.drag.id === tab.id);
  return <div className="folder-tab terminal-instance-tab" data-active={active} data-testid={`tab-row-${tab.id}`}
    data-tab-row-id={tab.id} data-tab-kind={tab.kind} data-tab-group={handle.capabilities.groupable ? groupId : ''}
    data-tab-surface={handle.capabilities.groupable ? undefined : 'canvas'}
    data-reorder-item={tab.id} data-reorder-kind={handle.capabilities.groupable && groupId ? 'tab' : 'loose-tab'}
    data-reorder-dragging={dragging ? 'true' : undefined} onPointerDown={event => {
      if (event.button !== 0 || event.isPrimary === false || (event.target as Element).closest('[data-no-drag], input')) return;
      onPointerDown(event);
      // Preserve the session input focus when pressing a tab's nested button.
      event.preventDefault();
      if (!active) onActivate();
    }}
    onClick={event => { if (!(event.target as Element).closest('button, input')) onActivate(); }}
    onDoubleClick={onStartEdit} onContextMenu={onContextMenu}>
    {editing ? <TextInput variant="field" className="inline-rename-input" autoFocus value={editTitle}
      onChange={event => setEditTitle(event.target.value)} onFocus={event => event.currentTarget.select()}
      onBlur={onCommitEdit} onKeyDown={event => {
        if (event.key === 'Enter') onCommitEdit(); else if (event.key === 'Escape') onCancelEdit();
      }} onClick={event => event.stopPropagation()} /> : <FolderTabContent item={handle} selected={active} onSelect={onActivate} onClose={onClose} />}
  </div>;
}
