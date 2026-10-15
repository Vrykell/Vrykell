import { TextInput } from '@ui/TextInput';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { iconSizes,
  History, Plus, Search, Settings, Sparkles,
  ChevronRight, Pencil, Archive, Folder, Trash2, X,
 } from '@ui/icons';
import { useSessionStore, isSessionTab, firstTerminalOf, terminalsOf, useTabDisplayTitle, tabIconKey, tabIconColor, type Tab, type TabGroup } from '@features/workspace';
import { useIconColorStore } from '@config/iconColors';
import { HistoryColorChoices } from '@ui/HistoryColorPalette';
import { regenerateTitle } from '@features/agent/services/title';
import { useToastStore } from '@ui/Toast';
import { IconBtn } from '@ui/UiBtn';
import { shellTypeLabel } from '@platform/shells';
import NewTabModal from '@features/workspace/components/NewTabModal';
import ContextMenu, { type ContextMenuItem } from '@ui/ContextMenu';
import SidebarItem from '@ui/sidebarItem';
import { SshIcon, shellIconFor } from '@ui/shellIcons';
import {
  ListReorderPlaceholder, ListReorderPreview, ListReorderZonePlaceholder,
  useListReorder, useListReorderDrag, type ListReorderDrag, type ListReorderTarget,
} from '@ui/listReorder';
import { t } from '@i18n';

/**
 * Session navigation with filtering, grouping, renaming and drag ordering.
 *
 * Rows render through the shared SidebarItem (same component as the SSH list)
 * and reordering uses the shared placeholder pattern: the dragged row leaves
 * its slot for a dashed gap that marks where it will land.
 */

/** One reorder list spans group headers and every tab row. */
const LIST_ID = 'session-tabs';
/** Zone id of the loose (ungrouped) area. */
const UNGROUPED_ZONE = 'ungrouped';

export default function PanelTabs() {
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
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalGroupId, setModalGroupId] = useState<string | undefined>(undefined);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingGroupTitle, setRenamingGroupTitle] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  useEffect(() => { loadGroups(); }, [loadGroups]);

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

  const startDrag = useListReorderDrag({ listId: LIST_ID, onDrop: commitDrop,
    accepts: (dragKind, itemKind) => dragKind === 'group' ? itemKind === 'group'
      : itemKind === 'loose-tab' || (dragKind === 'tab' && itemKind === 'tab'),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabs;
    return tabs.filter((t) => t.title.toLowerCase().includes(q));
  }, [tabs, query]);

  const groupTabs = (gid: string) => filtered.filter((t) => isSessionTab(t) && t.groupId === gid);
  const ungroupedTabs = filtered.filter((tab) => !isSessionTab(tab) || !tab.groupId);
  // 拖走的那行不参与「末尾占位」的判定（同 GroupSection）
  const draggedTabId = useListReorder((s) => (s.drag && s.drag.kind !== 'group' ? s.drag.id : undefined));
  const remainingUngrouped = ungroupedTabs.filter((tab) => tab.id !== draggedTabId);
  const lastUngroupedId = remainingUngrouped[remainingUngrouped.length - 1]?.id;

  const ctxTab = ctxMenu ? tabs.find((t) => t.id === ctxMenu.tabId) : undefined;
  const ctxItems: ContextMenuItem[] = ctxMenu && ctxTab
    ? [
        ...(isSessionTab(ctxTab) && !ctxTab.groupId ? [{
          label: '新建分组', group: 'organize' as const,
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
        // 组内标签的菜单补上出路：拖到「未分组」区之外，也能显式移出分组
        ...(isSessionTab(ctxTab) && ctxTab.groupId ? [{
          label: '移出分组', group: 'organize' as const,
          onClick: () => {
            const scope = tabs.filter((t) => t.id !== ctxTab.id && (!isSessionTab(t) || !t.groupId));
            useSessionStore.getState().moveTab(ctxTab.id, null, scope.length);
          },
        }] : []),
        ...(isSessionTab(ctxTab) ? [
          { label: '重命名', group: 'edit' as const, onClick: () => { setEditId(ctxTab.id); setEditTitle(ctxTab.title); } },
          { label: '重新生成标题', group: 'edit' as const, onClick: () => {
            useToastStore.getState().addToast('正在重新生成标题…', 'info');
            void regenerateTitle(ctxTab.id).then((ok) => {
              if (ok) useToastStore.getState().addToast('标题已更新', 'success');
            });
          } },
          { label: '复制会话', group: 'primary' as const, onClick: () => duplicateTab(ctxTab.id) },
        ] : []),
        { label: t('Close this tab'), danger: true, onClick: () => closeTab(ctxTab.id) },
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
          <TextInput
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
        {/* The panel button always creates ungrouped tabs; only a group's own + assigns that group. */}
        <IconBtn title="新建终端" data-testid="tab-new-btn" onClick={() => { setModalGroupId(undefined); setModalOpen(true); }}>
          <Plus size={iconSizes.control} />
        </IconBtn>
      </div>

      {/* 列表：分组头与标签行同属一个重排列表 */}
      <div data-reorder-list={LIST_ID} className="scroll-region" style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px', display: 'flex', flexDirection: 'column' }}>
        {groups.map((g) => (
          <Fragment key={g.id}>
            <ListReorderPlaceholder listId={LIST_ID} itemId={g.id} />
            <GroupSection
              group={g}
              tabs={groupTabs(g.id)}
              activeId={activeId}
              editId={editId}
              editTitle={editTitle}
              setEditTitle={setEditTitle}
              renamingGroupId={renamingGroupId}
              renamingGroupTitle={renamingGroupTitle}
              setRenamingGroupTitle={setRenamingGroupTitle}
              onActivate={activate}
              onClose={closeTab}
              onStartEdit={(id, title) => { setEditId(id); setEditTitle(title); }}
              onCommitEdit={() => { if (editId) renameTab(editId, editTitle); setEditId(null); }}
              onCancelEdit={() => setEditId(null)}
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
              onPointerDownTab={(event, tabId) => startDrag(event, { id: tabId, kind: 'tab' })}
              onPointerDownGroup={(event) => startDrag(event, { id: g.id, kind: 'group' })}
              onContextMenuTab={(e, tabId) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, tabId }); }}
              onAddTab={() => { setModalGroupId(g.id); setModalOpen(true); }}
            />
            <ListReorderPlaceholder listId={LIST_ID} itemId={g.id} after />
            {/* 收起/空分组没有可插入的行：悬停分组头时在组末尾占位（追加进组） */}
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
            style={{ marginTop: groups.length > 0 ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 2, flex: '1 0 auto', minHeight: 44 }}
          >
            {groups.length > 0 && (
              <div style={{ padding: '0 8px 2px', fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>未分组</div>
            )}
            {ungroupedTabs.map((t) => (
              <Fragment key={t.id}>
                <ListReorderPlaceholder listId={LIST_ID} itemId={t.id} />
                <TabRow
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
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>无匹配会话</div>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && ctxItems.length > 0 && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={ctxItems}
          footer={ctxTab && <>
            <div className="history-menu-color-label">{t('Icon color')}</div>
            <HistoryColorChoices menu label={t('Icon color')} value={iconColors[tabIconKey(ctxTab)] ?? null}
              testId="tab-icon-color" onSelect={color => {
                useIconColorStore.getState().setColor(tabIconKey(ctxTab), color); setCtxMenu(null);
              }} />
          </>}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <ListReorderPreview listId={LIST_ID}>
        {(drag) => {
          const tab = drag.kind !== 'group' ? tabs.find((t) => t.id === drag.id) : undefined;
          const first = tab ? firstTerminalOf(tab) : null;
          const Icon = drag.kind === 'group' ? Folder
            : tab?.kind === 'history' ? History
              : tab?.kind === 'ai-history' ? Sparkles
              : tab?.kind === 'settings' ? Settings
              : first?.kind === 'ssh' ? SshIcon
                : shellIconFor(first?.kind === 'local' ? first.shellType : undefined);
          return <Icon size={iconSizes.row} style={{ color: tab ? tabIconColor(tab, iconColors) : 'var(--accent-warm)' }} />;
        }}
      </ListReorderPreview>

      <NewTabModal open={modalOpen} groupId={modalGroupId} onClose={() => setModalOpen(false)} />
    </div>
  );
}

// ── 分组 section ──

function GroupSection(props: {
  group: TabGroup;
  tabs: Tab[];
  activeId: string;
  editId: string | null;
  editTitle: string;
  setEditTitle: (v: string) => void;
  renamingGroupId: string | null;
  renamingGroupTitle: string;
  setRenamingGroupTitle: (v: string) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onToggleCollapse: () => void;
  onStartRenameGroup: () => void;
  onCommitRenameGroup: () => void;
  onDeleteGroup: () => void;
  onPointerDownTab: (e: React.PointerEvent<HTMLElement>, tabId: string) => void;
  onPointerDownGroup: (e: React.PointerEvent<HTMLElement>) => void;
  onContextMenuTab: (e: React.MouseEvent, tabId: string) => void;
  onAddTab: () => void;
}) {
  const { group, tabs, activeId } = props;
  const collapsed = group.collapsed;
  const empty = tabs.length === 0;
  const anyMemberActive = tabs.some((t) => t.id === activeId);
  const dragging = useListReorder((s) => s.drag?.id === group.id);
  // 末尾占位对应当前可见的最后一行（拖走的那行不参与，否则拖末行时占位对不上）
  const draggedTabId = useListReorder((s) => (s.drag?.kind === 'tab' ? s.drag.id : undefined));
  const remainingTabs = tabs.filter((t) => t.id !== draggedTabId);
  const lastTabId = remainingTabs[remainingTabs.length - 1]?.id;
  return (
    <div style={{ marginBottom: 4, flexShrink: 0 }}>
      {/* Group containers stay transparent so selection belongs to a single row. */}
      <div
        className="tab-group-container"
        data-group-id={group.id}
        data-group-active={anyMemberActive ? 'true' : 'false'}
        data-reorder-zone={group.id}
        data-reorder-kind="tab"
        style={{ margin: 0, overflow: 'hidden' }}
      >
        {/* 分组头：图标徽章 + 名称 + 副标题 + 折叠 chevron */}
        <div
          className="tab-group-header"
          data-group-header-id={group.id}
          data-header-selected={(collapsed && anyMemberActive) ? 'true' : 'false'}
          data-renaming={props.renamingGroupId === group.id ? 'true' : undefined}
          data-testid={`group-header-${group.id}`}
          data-reorder-item={group.id}
          data-reorder-kind="group"
          data-reorder-dragging={dragging ? 'true' : undefined}
          onClick={() => { if (!props.renamingGroupId) props.onToggleCollapse(); }}
          onDoubleClick={() => {
            // 双击重命名（两次 click 已把折叠状态抵消回原样）
            if (props.renamingGroupId !== group.id) props.onStartRenameGroup();
          }}
          onPointerDown={props.onPointerDownGroup}
          data-tip="点击折叠/展开 · 双击重命名 · 拖拽排序"
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
            <TextInput
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
                flex: 1, minWidth: 0, background: 'var(--field-bg)', border: '1px solid var(--border)',
                borderRadius: 3, padding: '1px 4px', fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)',
                color: 'var(--text-primary)', outline: 'none',
              }}
            />
          ) : (
            <span data-testid={`group-title-${group.id}`} className="tab-group-title" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: 'calc(13px * var(--ui-font-scale))', lineHeight: '18px', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)',
              }}>
                {group.title}
              </span>
              <span data-testid={`group-count-${group.id}`} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'calc(10.5px * var(--ui-font-scale))', color: 'var(--text-muted)', lineHeight: '14px' }}>
                {t('panel.tabGroup.count', { n: tabs.length })}
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
              <Fragment key={t.id}>
                {/* 组内每行都有落点占位：拖进分组或组内换序都能看到预期的空位 */}
                <ListReorderPlaceholder listId={LIST_ID} itemId={t.id} />
                <div style={{ padding: '0 4px 0 12px' }}>
                  <TabRow
                    tab={t}
                    active={t.id === activeId}
                    editing={props.editId === t.id}
                    editTitle={props.editTitle}
                    setEditTitle={props.setEditTitle}
                    onActivate={() => props.onActivate(t.id)}
                    onClose={() => props.onClose(t.id)}
                    onStartEdit={() => props.onStartEdit(t.id, t.title)}
                    onCommitEdit={props.onCommitEdit}
                    onCancelEdit={props.onCancelEdit}
                    onPointerDown={(e) => props.onPointerDownTab(e, t.id)}
                    onContextMenu={(e) => props.onContextMenuTab(e, t.id)}
                  />
                </div>
              </Fragment>
            ))}
            {lastTabId && <ListReorderPlaceholder listId={LIST_ID} itemId={lastTabId} after />}
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
      <button data-subtle data-no-drag data-tip="在此分组新建终端" aria-label="在此分组新建终端"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        style={actionStyle}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
        <Plus size={iconSizes.compact} />
      </button>
      <button data-subtle data-no-drag data-tip="重命名分组" aria-label="重命名分组"
        onClick={(e) => { e.stopPropagation(); onRename(); }}
        style={actionStyle}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
        <Pencil size={iconSizes.compact} />
      </button>
      <button data-subtle data-no-drag data-tip={empty ? '删除分组' : '归档分组（移入会话历史）'} aria-label={empty ? '删除分组' : '归档分组（移入会话历史）'}
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
  tab, active, editing, editTitle, setEditTitle,
  onActivate, onClose, onStartEdit, onCommitEdit, onCancelEdit, onPointerDown, onContextMenu,
}: {
  tab: Tab;
  active: boolean;
  editing: boolean;
  editTitle: string;
  setEditTitle: (v: string) => void;
  onActivate: () => void;
  onClose: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const first = firstTerminalOf(tab);
  const terms = terminalsOf(tab);
  const displayTitle = useTabDisplayTitle(tab);
  const isSsh = first?.kind === 'ssh';
  const Icon = tab.kind === 'history' ? History
    : tab.kind === 'ai-history' ? Sparkles
    : tab.kind === 'settings' ? Settings
      : isSsh ? SshIcon
        : shellIconFor(first?.kind === 'local' ? first.shellType : undefined);
  const iconColors = useIconColorStore(state => state.colors);
  const iconColor = tabIconColor(tab, iconColors) ?? (isSessionTab(tab) ? undefined : active ? 'var(--text-primary)' : 'var(--text-secondary)');
  const typeSummary = terms.map((t) =>
    t.kind === 'ssh' ? (t.ssh?.name || t.ssh?.host || 'SSH') : (t.shellType ? shellTypeLabel(t.shellType) : '本地'),
  ).join(' + ');

  return (
    <SidebarItem
      active={active}
      icon={<Icon size={iconSizes.row} style={{ color: iconColor }} />}
      title={displayTitle}
      tooltip={displayTitle}
      testId={`tab-row-${tab.id}`}
      reorderItemId={tab.id}
      reorderKind={isSessionTab(tab) && tab.groupId ? 'tab' : 'loose-tab'}
      dataAttributes={{
        'data-tab-row-id': tab.id,
        'data-tab-kind': tab.kind,
        'data-tab-group': isSessionTab(tab) ? (tab.groupId ?? '') : '',
      }}
      onClick={onActivate}
      onDoubleClick={onStartEdit}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      renameInput={editing ? (
        <TextInput
          className="inline-rename-input"
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
        />
      ) : undefined}
      badge={tab.kind === 'session' && terms.length > 1 ? (
        <span
          data-tip={typeSummary}
          style={{ display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 6px', flexShrink: 0, lineHeight: '14px' }}
        >
          <span style={{ fontSize: 'calc(10px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {terms.length}
          </span>
        </span>
      ) : undefined}
      action={{
        icon: <X size={iconSizes.control} />,
        label: '关闭标签',
        title: '关闭标签',
        testId: `tab-close-${tab.id}`,
        onClick: onClose,
      }}
    />
  );
}
