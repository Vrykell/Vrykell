import {
  Archive,
  ChevronRight,
  Folder,
  History,
  Pencil,
  Plus,
  Search,
  Server,
  Settings,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconBtn } from '@/components/ui/Button/Button';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu/ContextMenu';
import NewTabModal from '@/components/ui/NewTabModal/NewTabModal';
import { useToastStore } from '@/components/ui/Toast/Toast';
import { regenerateTitle } from '@/features/agent/title';
import { shellTypeLabel } from '@/services/tauri/shells';
import { cx } from '@/shared/utils/cx';
import {
  firstTerminalOf,
  isSessionTab,
  type Tab,
  type TabGroup,
  terminalsOf,
  useWorkspaceStore,
} from '@/store/workspace';
import s from './PanelTabs.module.css';

type DropTarget =
  | { kind: 'tab'; groupId: string | null; beforeTabId: string | null }
  | { kind: 'group'; groupId: string | null };

const DRAG_THRESHOLD = 4;

function computeDropTarget(el: Element | null): DropTarget | null {
  if (!el || typeof el.closest !== 'function') return null;
  const tabEl = el.closest('[data-tab-row-id]');
  if (tabEl) {
    return {
      kind: 'tab',
      groupId: tabEl.getAttribute('data-tab-group') || null,
      beforeTabId: tabEl.getAttribute('data-tab-row-id'),
    };
  }
  const groupEl = el.closest('[data-group-id]');
  if (groupEl) {
    return { kind: 'group', groupId: groupEl.getAttribute('data-group-id') };
  }
  if (el.closest('[data-ungrouped]')) {
    return { kind: 'group', groupId: null };
  }
  return null;
}

export default function PanelTabs() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const groups = useWorkspaceStore((s) => s.groups);
  const activate = useWorkspaceStore((s) => s.activate);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const duplicateTab = useWorkspaceStore((s) => s.duplicateTab);
  const openHistoryTab = useWorkspaceStore((s) => s.openHistoryTab);
  const loadGroups = useWorkspaceStore((s) => s.loadGroups);
  const createGroupForTab = useWorkspaceStore((s) => s.createGroupForTab);
  const renameGroup = useWorkspaceStore((s) => s.renameGroup);
  const archiveGroup = useWorkspaceStore((s) => s.archiveGroup);
  const deleteGroup = useWorkspaceStore((s) => s.deleteGroup);
  const toggleGroupCollapse = useWorkspaceStore((s) => s.toggleGroupCollapse);

  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalGroupId, setModalGroupId] = useState<string | undefined>(undefined);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingGroupTitle, setRenamingGroupTitle] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  const dragRef = useRef<{
    type: 'tab' | 'group';
    id: string;
    startX: number;
    startY: number;
  } | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const dragActiveRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const info = dragRef.current;
      if (!info) return;
      if (
        Math.abs(e.clientX - info.startX) < DRAG_THRESHOLD &&
        Math.abs(e.clientY - info.startY) < DRAG_THRESHOLD
      )
        return;
      dragActiveRef.current = true;
      setDragging(true);
      setDragCursor({ x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = computeDropTarget(el);
      dropTargetRef.current = target;
      setDropTarget(target);
    };
    const onUp = () => {
      const info = dragRef.current;
      if (!info) return;
      const active = dragActiveRef.current;
      const target = dropTargetRef.current;
      if (active) commitDrop(info, target);
      dragRef.current = null;
      dropTargetRef.current = null;
      dragActiveRef.current = false;
      setDragging(false);
      setDropTarget(null);
      setDragCursor(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const commitDrop = (info: { type: 'tab' | 'group'; id: string }, target: DropTarget | null) => {
    const ws = useWorkspaceStore.getState();
    if (info.type === 'tab') {
      if (!target) {
        const src = ws.tabs.find((t) => t.id === info.id);
        if (src && isSessionTab(src) && src.groupId) {
          const scope = ws.tabs.filter((t) => isSessionTab(t) && (t.groupId ?? null) === null);
          ws.moveTab(info.id, null, scope.length);
        }
        return;
      }
      if (target.kind === 'tab') {
        const scope = ws.tabs.filter(
          (t) => isSessionTab(t) && (t.groupId ?? null) === target.groupId,
        );
        const idx =
          target.beforeTabId == null
            ? scope.length
            : Math.max(
                0,
                scope.findIndex((t) => t.id === target.beforeTabId),
              );
        ws.moveTab(info.id, target.groupId, idx);
      } else {
        const scope = ws.tabs.filter(
          (t) => isSessionTab(t) && (t.groupId ?? null) === target.groupId,
        );
        ws.moveTab(info.id, target.groupId, scope.length);
      }
    } else if (info.type === 'group') {
      if (target && target.kind === 'group') {
        const gs = ws.groups;
        const idx =
          target.groupId == null ? gs.length : gs.findIndex((g) => g.id === target.groupId);
        ws.moveGroup(info.id, idx);
      }
    }
  };

  const startDrag = (e: React.MouseEvent, type: 'tab' | 'group', id: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input,button,[data-no-drag]')) return;
    dragRef.current = { type, id, startX: e.clientX, startY: e.clientY };
    dragActiveRef.current = false;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabs;
    return tabs.filter((t) => t.title.toLowerCase().includes(q));
  }, [tabs, query]);

  const groupTabs = (gid: string) => filtered.filter((t) => isSessionTab(t) && t.groupId === gid);
  const ungroupedTabs = filtered.filter((t) => isSessionTab(t) && !t.groupId);
  const activeTab = tabs.find((t) => t.id === activeId);
  const activeGroupId = activeTab && isSessionTab(activeTab) ? activeTab.groupId : undefined;

  const ctxTab = ctxMenu ? tabs.find((t) => t.id === ctxMenu.tabId) : undefined;
  const ctxItems: ContextMenuItem[] =
    ctxMenu && ctxTab
      ? [
          ...(isSessionTab(ctxTab) && !ctxTab.groupId
            ? [
                {
                  label: '新建分组',
                  onClick: () => {
                    void createGroupForTab(ctxTab.id).then((gid) => {
                      if (!gid) return;
                      const g = useWorkspaceStore.getState().groups.find((x) => x.id === gid);
                      setRenamingGroupId(gid);
                      setRenamingGroupTitle(g?.title ?? '新分组');
                    });
                  },
                },
              ]
            : []),
          {
            label: '重命名',
            onClick: () => {
              setEditId(ctxTab.id);
              setEditTitle(ctxTab.title);
            },
          },
          {
            label: '重新生成标题',
            onClick: () => {
              useToastStore.getState().addToast('正在重新生成标题…', 'info');
              void regenerateTitle(ctxTab.id).then((ok) => {
                if (ok) useToastStore.getState().addToast('标题已更新', 'success');
              });
            },
          },
          { label: '复制会话', onClick: () => duplicateTab(ctxTab.id) },
          { label: '关闭标签', onClick: () => closeTab(ctxTab.id) },
        ]
      : [];

  return (
    <div className={s.panel}>
      {/* 顶栏 */}
      <div className={s.toolbar}>
        <div className={s.searchBox}>
          <Search size={12} className={s.searchIcon} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话…"
            data-testid="tab-search"
            className={s.searchInput}
          />
        </div>
        <IconBtn title="会话历史" data-testid="tab-history-btn" onClick={openHistoryTab}>
          <History size={14} />
        </IconBtn>
        <IconBtn
          title="新建终端"
          data-testid="tab-new-btn"
          onClick={() => {
            setModalGroupId(activeGroupId);
            setModalOpen(true);
          }}
        >
          <Plus size={14} />
        </IconBtn>
      </div>

      {/* 列表 */}
      <div className={s.list}>
        {groups.map((g) => (
          <GroupSection
            key={g.id}
            group={g}
            tabs={groupTabs(g.id)}
            activeId={activeId}
            hoveredId={hoveredId}
            editId={editId}
            editTitle={editTitle}
            setEditTitle={setEditTitle}
            renamingGroupId={renamingGroupId}
            renamingGroupTitle={renamingGroupTitle}
            setRenamingGroupTitle={setRenamingGroupTitle}
            dropTarget={dropTarget}
            onActivate={activate}
            onClose={closeTab}
            onStartEdit={(id, title) => {
              setEditId(id);
              setEditTitle(title);
            }}
            onCommitEdit={() => {
              if (editId) renameTab(editId, editTitle);
              setEditId(null);
            }}
            onCancelEdit={() => setEditId(null)}
            onHover={(h, id) => setHoveredId(h ? id : null)}
            onToggleCollapse={() => toggleGroupCollapse(g.id)}
            onStartRenameGroup={() => {
              setRenamingGroupId(g.id);
              setRenamingGroupTitle(g.title);
            }}
            onCommitRenameGroup={() => {
              if (renamingGroupId) renameGroup(renamingGroupId, renamingGroupTitle);
              setRenamingGroupId(null);
            }}
            onDeleteGroup={() => {
              const hasTabs = groupTabs(g.id).length > 0;
              if (!hasTabs) {
                void deleteGroup(g.id, false);
                return;
              }
              if (!window.confirm(`归档分组「${g.title}」？组内标签将关闭并移入会话历史。`)) return;
              void archiveGroup(g.id);
            }}
            onMouseDownTab={(e, tabId) => startDrag(e, 'tab', tabId)}
            onMouseDownGroup={(e) => startDrag(e, 'group', g.id)}
            onContextMenuTab={(e, tabId) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu({ x: e.clientX, y: e.clientY, tabId });
            }}
            onAddTab={() => {
              setModalGroupId(g.id);
              setModalOpen(true);
            }}
          />
        ))}

        {ungroupedTabs.length > 0 && (
          <div
            data-ungrouped="true"
            style={{
              marginTop: groups.length > 0 ? 6 : 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {groups.length > 0 && <div className={s.ungroupedLabel}>未分组</div>}
            {ungroupedTabs.map((t) => (
              <TabRow
                key={t.id}
                tab={t}
                active={t.id === activeId}
                hovered={t.id === hoveredId}
                editing={editId === t.id}
                editTitle={editTitle}
                setEditTitle={setEditTitle}
                groupId={null}
                onActivate={() => activate(t.id)}
                onClose={() => closeTab(t.id)}
                onStartEdit={() => {
                  setEditId(t.id);
                  setEditTitle(t.title);
                }}
                onCommitEdit={() => {
                  renameTab(t.id, editTitle);
                  setEditId(null);
                }}
                onCancelEdit={() => setEditId(null)}
                onHover={(h) => setHoveredId(h ? t.id : null)}
                onMouseDown={(e) => startDrag(e, 'tab', t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCtxMenu({ x: e.clientX, y: e.clientY, tabId: t.id });
                }}
                highlight={
                  dropTarget?.kind === 'tab' &&
                  dropTarget.groupId === null &&
                  dropTarget.beforeTabId === t.id
                }
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div
            style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}
          >
            无匹配会话
          </div>
        )}
      </div>

      {ctxMenu && ctxItems.length > 0 && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {dragging && dragCursor && dragRef.current && (
        <DragGhost
          type={dragRef.current.type}
          id={dragRef.current.id}
          tabs={tabs}
          x={dragCursor.x}
          y={dragCursor.y}
        />
      )}

      <NewTabModal open={modalOpen} groupId={modalGroupId} onClose={() => setModalOpen(false)} />
    </div>
  );
}

// ── 分组 section ──

function GroupSection(props: {
  group: TabGroup;
  tabs: Tab[];
  activeId: string;
  hoveredId: string | null;
  editId: string | null;
  editTitle: string;
  setEditTitle: (v: string) => void;
  renamingGroupId: string | null;
  renamingGroupTitle: string;
  setRenamingGroupTitle: (v: string) => void;
  dropTarget: DropTarget | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onHover: (h: boolean, id: string) => void;
  onToggleCollapse: () => void;
  onStartRenameGroup: () => void;
  onCommitRenameGroup: () => void;
  onDeleteGroup: () => void;
  onMouseDownTab: (e: React.MouseEvent, tabId: string) => void;
  onMouseDownGroup: (e: React.MouseEvent) => void;
  onContextMenuTab: (e: React.MouseEvent, tabId: string) => void;
  onAddTab: () => void;
}) {
  const { group, tabs, activeId } = props;
  const collapsed = group.collapsed;
  const empty = tabs.length === 0;
  const groupHighlight =
    props.dropTarget?.kind === 'group' && props.dropTarget.groupId === group.id;
  const anyMemberActive = tabs.some((t) => t.id === activeId);

  return (
    <div className={s.groupSection}>
      <div
        className="tab-group-container"
        data-group-id={group.id}
        data-group-active={anyMemberActive ? 'true' : 'false'}
        style={{
          margin: 0,
          overflow: 'hidden',
          boxShadow: groupHighlight ? 'inset 0 0 0 1px var(--accent)' : 'none',
        }}
      >
        <div
          className={cx('tab-group-header', s.groupHeader)}
          data-group-header-id={group.id}
          data-header-selected={collapsed && anyMemberActive ? 'true' : 'false'}
          data-testid={`group-header-${group.id}`}
          onClick={() => {
            if (!props.renamingGroupId) props.onToggleCollapse();
          }}
          onDoubleClick={() => {
            if (props.renamingGroupId !== group.id) props.onStartRenameGroup();
          }}
          onMouseDown={props.onMouseDownGroup}
          title="点击折叠/展开 · 双击重命名 · 拖拽排序"
        >
          <span className={s.groupIcon}>
            <Folder size={14} />
          </span>
          {props.renamingGroupId === group.id ? (
            <input
              autoFocus
              value={props.renamingGroupTitle}
              onChange={(e) => props.setRenamingGroupTitle(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={props.onCommitRenameGroup}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onCommitRenameGroup();
                else if (e.key === 'Escape') props.setRenamingGroupTitle(group.title);
              }}
              className={cx(s.renameInput, s.groupTitle)}
            />
          ) : (
            <span className={s.groupInfo}>
              <span className={s.groupTitle}>{group.title}</span>
              <span className={s.groupCount}>{tabs.length} 个标签</span>
            </span>
          )}
          <GroupActions
            empty={empty}
            onAdd={props.onAddTab}
            onRename={props.onStartRenameGroup}
            onDelete={props.onDeleteGroup}
          />
          <ChevronRight size={13} className={cx(s.chevron, !collapsed && s.chevronOpen)} />
        </div>

        {!collapsed && (
          <div className={s.groupContent}>
            {tabs.map((t) => (
              <div key={t.id} className={s.groupContentInner}>
                <TabRow
                  tab={t}
                  active={t.id === activeId}
                  hovered={t.id === props.hoveredId}
                  editing={props.editId === t.id}
                  editTitle={props.editTitle}
                  setEditTitle={props.setEditTitle}
                  groupId={group.id}
                  onActivate={() => props.onActivate(t.id)}
                  onClose={() => props.onClose(t.id)}
                  onStartEdit={() => props.onStartEdit(t.id, t.title)}
                  onCommitEdit={props.onCommitEdit}
                  onCancelEdit={props.onCancelEdit}
                  onHover={(h) => props.onHover(h, t.id)}
                  onMouseDown={(e) => props.onMouseDownTab(e, t.id)}
                  onContextMenu={(e) => props.onContextMenuTab(e, t.id)}
                  highlight={
                    props.dropTarget?.kind === 'tab' &&
                    props.dropTarget.groupId === group.id &&
                    props.dropTarget.beforeTabId === t.id
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupActions({
  onAdd,
  onRename,
  onDelete,
  empty,
}: {
  onAdd: () => void;
  onRename: () => void;
  onDelete: () => void;
  empty: boolean;
}) {
  return (
    <span
      className="group-actions"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
    >
      <button
        data-subtle
        data-no-drag
        title="在此分组新建终端"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        className={s.groupActions}
      >
        <Plus size={12} />
      </button>
      <button
        data-subtle
        data-no-drag
        title="重命名分组"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        className={s.groupActions}
      >
        <Pencil size={12} />
      </button>
      <button
        data-subtle
        data-no-drag
        title={empty ? '删除分组' : '归档分组（移入会话历史）'}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={s.groupActions}
        style={empty ? { color: 'var(--error-light)' } : undefined}
      >
        {empty ? <Trash2 size={12} /> : <Archive size={12} />}
      </button>
    </span>
  );
}

// ── 标签行 ──

function TabRow({
  tab,
  active,
  hovered,
  editing,
  editTitle,
  setEditTitle,
  groupId,
  onActivate,
  onClose,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onHover,
  onMouseDown,
  onContextMenu,
  highlight,
}: {
  tab: Tab;
  active: boolean;
  hovered: boolean;
  editing: boolean;
  editTitle: string;
  setEditTitle: (v: string) => void;
  groupId: string | null;
  onActivate: () => void;
  onClose: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onHover: (h: boolean) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  highlight?: boolean;
}) {
  const first = firstTerminalOf(tab);
  const terms = terminalsOf(tab);
  const isSsh = first?.kind === 'ssh';
  const Icon =
    tab.kind === 'history'
      ? History
      : tab.kind === 'settings'
        ? Settings
        : isSsh
          ? Server
          : SquareTerminal;
  const iconColor = active ? 'var(--accent)' : 'var(--text-secondary)';
  const iconBg = active ? 'var(--accent-bg)' : 'transparent';
  const typeSummary = terms
    .map((t) =>
      t.kind === 'ssh'
        ? t.ssh?.name || t.ssh?.host || 'SSH'
        : t.shellType
          ? shellTypeLabel(t.shellType)
          : '本地',
    )
    .join(' + ');
  const subtitle =
    tab.kind === 'history' ? '会话历史' : tab.kind === 'settings' ? '设置' : undefined;

  const inGroup = groupId != null;
  const outerBg = !inGroup && (active || hovered) ? 'var(--tab-hover)' : 'transparent';
  let innerBg = 'transparent';
  if (highlight) innerBg = 'var(--tab-hover)';
  else if (active) innerBg = 'var(--tab-active)';
  else if (hovered) innerBg = 'var(--tab-hover)';

  return (
    <div
      onClick={onActivate}
      onDoubleClick={onStartEdit}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      title={tab.title}
      data-testid={`tab-row-${tab.id}`}
      data-tab-row-id={tab.id}
      data-tab-group={groupId ?? ''}
      style={{ padding: 10, background: outerBg, cursor: 'pointer' }}
    >
      <div
        className={cx(s.tabRow, highlight && s.tabRowDragOver)}
        style={{
          background: innerBg,
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        <span className={s.tabIcon} style={{ background: iconBg, color: iconColor }}>
          <Icon size={15} />
        </span>
        {editing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={onCommitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitEdit();
              else if (e.key === 'Escape') onCancelEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            className={s.renameInput}
          />
        ) : (
          <span className={s.tabInfo}>
            <span className={cx(s.tabTitle, active && s.tabTitleActive)}>{tab.title}</span>
            {subtitle && <span className={s.tabStatus}>{subtitle}</span>}
          </span>
        )}
        {tab.kind === 'session' && (
          <span
            className={s.tabStatus}
            style={{
              color: 'var(--shell-connected)',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              padding: '0 4px',
            }}
          >
            {typeSummary}
          </span>
        )}
        {tab.kind === 'session' && (
          <button
            data-subtle
            data-no-drag
            title="关闭标签"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className={s.tabStatus}
            style={{
              display: 'none',
              width: 16,
              height: 16,
              border: 'none',
              borderRadius: 3,
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 10,
              padding: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--error-light)';
              e.currentTarget.style.background = 'var(--hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <XIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function XIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <title>关闭</title>
      <line x1="2" y1="2" x2="8" y2="8" />
      <line x1="8" y1="2" x2="2" y2="8" />
    </svg>
  );
}

// ── 拖拽预览 ──

function DragGhost({
  type,
  id,
  tabs,
  x,
  y,
}: {
  type: 'tab' | 'group';
  id: string;
  tabs: Tab[];
  x: number;
  y: number;
}) {
  const label = type === 'tab' ? (tabs.find((t) => t.id === id)?.title ?? '…') : '分组';
  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        padding: '4px 10px',
        borderRadius: 5,
        background: 'var(--elevated)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-primary)',
        fontSize: 12,
        fontWeight: 500,
        pointerEvents: 'none',
        zIndex: 9999,
        opacity: 0.92,
        transform: 'translate(8px, 8px)',
      }}
    >
      {label}
    </div>
  );
}
