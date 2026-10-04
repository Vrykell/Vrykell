import { useEffect, useMemo, useRef, useState } from 'react';
import { iconSizes,
  History, Plus, Search, Server, Settings, SquareTerminal,
  ChevronRight, Pencil, Archive, Folder, Trash2, X,
 } from '@ui/icons';
import { useSessionStore, isSessionTab, firstTerminalOf, terminalsOf, type Tab, type TabGroup } from '@features/workspace';
import { regenerateTitle } from '@features/agent/services/title';
import { useToastStore } from '@ui/Toast';
import { IconBtn } from '@ui/UiBtn';
import { shellTypeLabel } from '@platform/shells';
import NewTabModal from '@features/workspace/components/NewTabModal';
import ContextMenu, { type ContextMenuItem } from '@ui/ContextMenu';
import { sidebarRowSpacing, sidebarRowContent, sidebarRowIcon, sidebarRowTitle } from '@ui/sidebarRow';

/**
 * Session navigation with filtering, grouping, renaming and drag ordering.
 * Each row uses one subtle background for hover or selection.
 */

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
  const tabs = useSessionStore((s) => s.tabs);
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
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalGroupId, setModalGroupId] = useState<string | undefined>(undefined);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingGroupTitle, setRenamingGroupTitle] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  // 自定义拖拽
  const dragRef = useRef<{ type: 'tab' | 'group'; id: string; startX: number; startY: number } | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const dragActiveRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const info = dragRef.current;
      if (!info) return;
      if (Math.abs(e.clientX - info.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - info.startY) < DRAG_THRESHOLD) {
        return;
      }
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
    const ws = useSessionStore.getState();
    if (info.type === 'tab') {
      if (!target) {
        // 拖到侧栏空白区域（不在任何标签/分组上）：组内标签直接脱离分组，自由标签不动
        const src = ws.tabs.find((t) => t.id === info.id);
        if (src && isSessionTab(src) && src.groupId) {
          const scope = ws.tabs.filter((t) => isSessionTab(t) && (t.groupId ?? null) === null);
          ws.moveTab(info.id, null, scope.length);
        }
        return;
      }
      if (target.kind === 'tab') {
        const scope = ws.tabs.filter((t) => isSessionTab(t) && (t.groupId ?? null) === target.groupId);
        const idx = target.beforeTabId == null ? scope.length : Math.max(0, scope.findIndex((t) => t.id === target.beforeTabId));
        ws.moveTab(info.id, target.groupId, idx);
      } else {
        const scope = ws.tabs.filter((t) => isSessionTab(t) && (t.groupId ?? null) === target.groupId);
        ws.moveTab(info.id, target.groupId, scope.length);
      }
    } else if (info.type === 'group') {
      if (target && target.kind === 'group') {
        const gs = ws.groups;
        const idx = target.groupId == null ? gs.length : gs.findIndex((g) => g.id === target.groupId);
        ws.moveGroup(info.id, idx);
      }
    }
  };

  const startDrag = (e: React.MouseEvent, type: 'tab' | 'group', id: string) => {
    // 仅左键拖拽；忽略输入框/按钮
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
  const ctxItems: ContextMenuItem[] = ctxMenu && ctxTab
    ? [
        ...(isSessionTab(ctxTab) && !ctxTab.groupId ? [{
          label: '新建分组',
          onClick: () => {
            // 建组后立即进入重命名（自动聚焦名称输入框）
            void createGroupForTab(ctxTab.id).then((gid) => {
              if (!gid) return;
              const g = useSessionStore.getState().groups.find((x) => x.id === gid);
              setRenamingGroupId(gid);
              setRenamingGroupTitle(g?.title ?? '新分组');
            });
          },
        }] : []),
        { label: '重命名', onClick: () => { setEditId(ctxTab.id); setEditTitle(ctxTab.title); } },
        { label: '重新生成标题', onClick: () => {
          useToastStore.getState().addToast('正在重新生成标题…', 'info');
          void regenerateTitle(ctxTab.id).then((ok) => {
            if (ok) useToastStore.getState().addToast('标题已更新', 'success');
          });
        } },
        { label: '复制会话', onClick: () => duplicateTab(ctxTab.id) },
        { label: '关闭标签', onClick: () => closeTab(ctxTab.id) },
      ]
    : [];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      userSelect: 'none', background: 'transparent',
    }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 10px 8px',
        position: 'relative',
      }}>
        <div className="workspace-sidebar-search" style={{
          display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0,
          background: 'var(--chrome-field)',
          borderRadius: 'var(--radius-inner)', padding: '0 8px', height: 30,
        }}>
          <Search size={iconSizes.compact} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话…"
            data-testid="tab-search"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
            }}
          />
        </div>
        <IconBtn title="会话历史" data-testid="tab-history-btn" onClick={openHistoryTab}>
          <History size={iconSizes.control} />
        </IconBtn>
        <IconBtn title="新建终端" data-testid="tab-new-btn" onClick={() => { setModalGroupId(activeGroupId); setModalOpen(true); }}>
          <Plus size={iconSizes.control} />
        </IconBtn>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
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
            onStartEdit={(id, title) => { setEditId(id); setEditTitle(title); }}
            onCommitEdit={() => { if (editId) renameTab(editId, editTitle); setEditId(null); }}
            onCancelEdit={() => setEditId(null)}
            onHover={(h, id) => setHoveredId(h ? id : null)}
            onToggleCollapse={() => toggleGroupCollapse(g.id)}
            onStartRenameGroup={() => { setRenamingGroupId(g.id); setRenamingGroupTitle(g.title); }}
            onCommitRenameGroup={() => { if (renamingGroupId) renameGroup(renamingGroupId, renamingGroupTitle); setRenamingGroupId(null); }}
            onDeleteGroup={() => {
              const hasTabs = groupTabs(g.id).length > 0;
              if (!hasTabs) { void deleteGroup(g.id, false); return; }
              const ok = window.confirm(`归档分组「${g.title}」？组内标签将关闭并移入会话历史。`);
              if (!ok) return;
              void archiveGroup(g.id);
            }}
            onMouseDownTab={(e, tabId) => startDrag(e, 'tab', tabId)}
            onMouseDownGroup={(e) => startDrag(e, 'group', g.id)}
            onContextMenuTab={(e, tabId) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, tabId }); }}
            onAddTab={() => { setModalGroupId(g.id); setModalOpen(true); }}
          />
        ))}

        {ungroupedTabs.length > 0 && (
          <div data-ungrouped="true" style={{ marginTop: groups.length > 0 ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {groups.length > 0 && (
              <div style={{ padding: '0 8px 2px', fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>未分组</div>
            )}
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
                onStartEdit={() => { setEditId(t.id); setEditTitle(t.title); }}
                onCommitEdit={() => { renameTab(t.id, editTitle); setEditId(null); }}
                onCancelEdit={() => setEditId(null)}
                onHover={(h) => setHoveredId(h ? t.id : null)}
                onMouseDown={(e) => startDrag(e, 'tab', t.id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, tabId: t.id }); }}
                highlight={dropTarget?.kind === 'tab' && dropTarget.groupId === null && dropTarget.beforeTabId === t.id}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>无匹配会话</div>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && ctxItems.length > 0 && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* 拖拽预览：鼠标附近的标签图（无文字） */}
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
  const groupHighlight = props.dropTarget?.kind === 'group' && props.dropTarget.groupId === group.id;
  const anyMemberActive = tabs.some((t) => t.id === activeId);
  return (
    <div style={{ marginBottom: 4 }}>
      {/* Group containers stay transparent so selection belongs to a single row. */}
      <div
        className="tab-group-container"
        data-group-id={group.id}
        data-group-active={anyMemberActive ? 'true' : 'false'}
        style={{
          margin: 0, overflow: 'hidden',
          boxShadow: groupHighlight ? 'inset 0 0 0 1px var(--accent)' : 'none',
        }}
      >
        {/* 分组头：图标徽章 + 名称 + 副标题 + 折叠 chevron */}
        <div
          className="tab-group-header"
          data-group-header-id={group.id}
          data-header-selected={(collapsed && anyMemberActive) ? 'true' : 'false'}
          data-testid={`group-header-${group.id}`}
          onClick={() => { if (!props.renamingGroupId) props.onToggleCollapse(); }}
          onDoubleClick={() => {
            // 双击重命名（两次 click 已把折叠状态抵消回原样）
            if (props.renamingGroupId !== group.id) props.onStartRenameGroup();
          }}
          onMouseDown={props.onMouseDownGroup}
          title="点击折叠/展开 · 双击重命名 · 拖拽排序"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', minHeight: 40, cursor: 'pointer',
          }}
        >
          <span style={{
            width: 24, height: 24, borderRadius: 6, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--hover)', color: 'var(--text-secondary)',
          }}>
            <Folder size={iconSizes.row} />
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
              style={{
                flex: 1, background: 'var(--canvas)', border: '1px solid var(--accent)',
                borderRadius: 3, padding: '1px 4px', fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 600,
                color: 'var(--text-primary)', outline: 'none',
              }}
            />
          ) : (
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: 'calc(13px * var(--ui-font-scale))', lineHeight: '18px', fontWeight: 600, color: 'var(--text-primary)',
              }}>
                {group.title}
              </span>
              <span style={{ fontSize: 'calc(10.5px * var(--ui-font-scale))', color: 'var(--text-muted)', lineHeight: '14px' }}>
                {tabs.length} 个标签
              </span>
            </span>
          )}
          <GroupActions
            empty={empty}
            onAdd={props.onAddTab}
            onRename={props.onStartRenameGroup}
            onDelete={props.onDeleteGroup}
          />
          <ChevronRight
            size={iconSizes.compact}
            style={{
              color: 'var(--text-muted)', flexShrink: 0,
              transition: 'transform 0.12s ease', transform: collapsed ? 'none' : 'rotate(90deg)',
            }}
          />
        </div>

        {/* 展开：组内标签与自由标签同尺寸，靠左缩进 12px 体现层级 */}
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 0 4px' }}>
            {tabs.map((t) => (
              <div key={t.id} style={{ padding: '0 4px 0 12px' }}>
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
                  highlight={props.dropTarget?.kind === 'tab' && props.dropTarget.groupId === group.id && props.dropTarget.beforeTabId === t.id}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupActions({ onAdd, onRename, onDelete, empty }: {
  onAdd: () => void;
  onRename: () => void;
  onDelete: () => void;
  empty: boolean;
}) {
  return (
    <span className="group-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <button data-subtle data-no-drag title="在此分组新建终端"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        style={actionStyle}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
        <Plus size={iconSizes.compact} />
      </button>
      <button data-subtle data-no-drag title="重命名分组"
        onClick={(e) => { e.stopPropagation(); onRename(); }}
        style={actionStyle}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
        <Pencil size={iconSizes.compact} />
      </button>
      <button data-subtle data-no-drag title={empty ? '删除分组' : '归档分组（移入会话历史）'}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={actionStyle}
        onMouseEnter={(e) => { e.currentTarget.style.color = empty ? 'var(--error-light)' : 'var(--text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
        {empty ? <Trash2 size={iconSizes.compact} /> : <Archive size={iconSizes.compact} />}
      </button>
    </span>
  );
}

const actionStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, padding: 0, border: 'none', borderRadius: 4,
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};

// ── 标签行 ──

function TabRow({
  tab, active, hovered, editing, editTitle, setEditTitle, groupId,
  onActivate, onClose, onStartEdit, onCommitEdit, onCancelEdit, onHover, onMouseDown, onContextMenu, highlight,
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
  const Icon = tab.kind === 'history' ? History : tab.kind === 'settings' ? Settings : isSsh ? Server : SquareTerminal;
  const iconColor = active ? 'var(--text-primary)' : 'var(--text-secondary)';
  const typeSummary = terms.map((t) =>
    t.kind === 'ssh' ? (t.ssh?.name || t.ssh?.host || 'SSH') : (t.shellType ? shellTypeLabel(t.shellType) : '本地'),
  ).join(' + ');
  // Only multi-pane sessions need a count beside the tab title.
  const subtitle = tab.kind === 'history' ? '会话历史' : tab.kind === 'settings' ? '设置' : undefined;

  // Keep selection on the content row rather than its surrounding spacing.
  const innerBg = active || highlight ? 'var(--selection-bg)' : hovered ? 'var(--hover)' : 'transparent';

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
      style={sidebarRowSpacing}
    >
      <div style={{
        ...sidebarRowContent,
        background: innerBg,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
        <span style={{
          ...sidebarRowIcon,
          color: iconColor,
        }}>
          <Icon size={iconSizes.row} />
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
            style={{
              flex: 1, background: 'var(--canvas)', border: '1px solid var(--accent)',
              borderRadius: 3, padding: '1px 4px', fontSize: 'calc(13px * var(--ui-font-scale))',
              color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-ui)',
            }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{
              ...sidebarRowTitle,
              fontWeight: active ? 600 : 500,
            }}>
              {tab.title}
            </span>
            {subtitle && (
              <span style={{
                fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', lineHeight: '14px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
              }}>
                {subtitle}
              </span>
            )}
          </span>
        )}
        {tab.kind === 'session' && terms.length > 1 && (
          <span
            title={typeSummary}
            style={{
              display: 'inline-flex', alignItems: 'center',
              height: 16, padding: '0 6px', flexShrink: 0,
              lineHeight: '14px',
            }}
          >
            <span style={{ fontSize: 'calc(10px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {terms.length}
            </span>
          </span>
        )}
        <button type="button" data-subtle aria-label="关闭标签" className="sidebar-row-action"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          onDoubleClick={(e) => e.stopPropagation()}
          title="关闭标签"
          data-testid={`tab-close-${tab.id}`}
          data-no-drag
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 1,
            borderRadius: 4, flexShrink: 0,
            color: 'var(--text-muted)',
            opacity: (active || hovered) ? 1 : 0,
            transition: 'opacity 0.12s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--button-hover)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
          }}
        ><X size={iconSizes.control} /></button>
      </div>
    </div>
  );
}

// ── 拖拽预览（标签图，无文字）──

function DragGhost({ type, id, tabs, x, y }: {
  type: 'tab' | 'group';
  id: string;
  tabs: Tab[];
  x: number;
  y: number;
}) {
  const tab = type === 'tab' ? tabs.find((t) => t.id === id) : undefined;
  const first = tab ? firstTerminalOf(tab) : null;
  const isSsh = type === 'tab' && first?.kind === 'ssh';
  const Icon = type === 'tab'
    ? (tab?.kind === 'history' ? History : tab?.kind === 'settings' ? Settings : isSsh ? Server : SquareTerminal)
    : Folder;
  const color = type === 'group' ? 'var(--accent-warm)' : 'var(--accent)';
  return (
    <div className="workspace-floating" style={{
      position: 'fixed', left: x, top: y, zIndex: 9999, pointerEvents: 'none',
      transform: 'translate(-50%, -60%) scale(1.06)',
      width: 40, height: 26,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'dragGhostIn 0.1s ease',
    }}>
      <Icon size={iconSizes.row} style={{ color }} />
    </div>
  );
}

// ── 通用 ──
