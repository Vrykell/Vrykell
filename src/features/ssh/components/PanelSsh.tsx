import { Fragment, useEffect, useMemo, useState } from 'react';
import { iconSizes, Pencil, Plus, Search } from '@ui/icons';
import { SshIcon } from '@ui/shellIcons';
import { ask } from '@tauri-apps/plugin-dialog';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { useSessionStore } from '@features/workspace';
import ContextMenu from '@ui/ContextMenu';
import { IconBtn } from '@ui/UiBtn';
import SidebarItem from '@ui/sidebarItem';
import { ListReorderPlaceholder, ListReorderPreview, useListReorderDrag } from '@ui/listReorder';
import type { SshConnection } from '@features/ssh/services/api';
import { connectionTarget } from '@features/ssh/services/api';
import SshFormModal from '@features/ssh/components/SshFormModal';

/** List id shared by the rows, their placeholders and the drag hook. */
const LIST_ID = 'ssh-connections';

/**
 * PanelSsh — SSH 远程连接管理侧栏。
 * 顶栏：搜索（按名字过滤）+ 编辑当前选中 + 新建。
 * 列表：已有连接；点击选中，双击创建活跃会话（终端标签页），拖拽排序。
 */
export default function PanelSsh() {
  const connections = useSshStore((s) => s.connections);
  const touch = useSshStore((s) => s.touch);
  const remove = useSshStore((s) => s.remove);
  const reorder = useSshStore((s) => s.reorder);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [editing, setEditing] = useState<SshConnection | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; conn: SshConnection } | null>(null);

  useEffect(() => { ensureSshLoaded(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((c) => c.name.toLowerCase().includes(q));
  }, [connections, query]);

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId],
  );

  const startDrag = useListReorderDrag({
    listId: LIST_ID,
    onDrop: (drag, target) => {
      if (!target?.itemId || drag.id === target.itemId) return;
      const from = connections.findIndex((c) => c.id === drag.id);
      const over = connections.findIndex((c) => c.id === target.itemId);
      if (from < 0 || over < 0) return;
      let to = over + (target.after ? 1 : 0);
      if (from < to) to -= 1;
      if (to !== from) reorder(from, to);
    },
  });

  const openConnection = (conn: SshConnection) => {
    setSelectedId(conn.id);
    void touch(conn.id);
    useSessionStore.getState().addTab({
      kind: 'ssh',
      ssh: connectionTarget(conn),
    });
    // File browsing is an optional service and should not replace connection navigation.
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;
    setEditing(selected);
    setFormOpen(true);
  };

  /** 右键菜单：编辑指定连接 */
  const editConn = (conn: SshConnection) => {
    setEditing(conn);
    setFormOpen(true);
  };

  /** 右键菜单：删除指定连接（二次确认） */
  const removeConn = async (conn: SshConnection) => {
    const ok = await ask(`删除 SSH 连接「${conn.name}」？`, { title: '删除', kind: 'warning' });
    if (ok) void remove(conn.id);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      userSelect: 'none', background: 'transparent',
    }}>
      {/* 顶栏：搜索 + 编辑 + 新建 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 10px 8px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0,
          background: 'var(--chrome-field)',
          borderRadius: 'var(--radius-inner)', padding: '0 8px', height: 30,
        }}>
          <Search size={iconSizes.compact} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 SSH 连接…"
            data-testid="ssh-search"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
            }}
          />
        </div>
        <IconBtn
          title={selected ? `编辑「${selected.name}」` : '编辑当前选中的连接'}
          disabled={!selected}
          data-testid="ssh-edit-btn"
          onClick={openEdit}
        >
          <Pencil size={iconSizes.control} />
        </IconBtn>
        <IconBtn title="新建 SSH 连接" data-testid="ssh-new-btn" onClick={openNew}>
          <Plus size={iconSizes.control} />
        </IconBtn>
      </div>
      <button data-testid="ssh-quick-btn" onClick={() => setQuickOpen(true)} style={{ margin: '0 10px 10px', minHeight: 36 }}>快速连接</button>
      {/* 连接列表：拖动时源行让位，落点用虚线占位 */}
      <div data-reorder-list={LIST_ID} className="scroll-region" style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
            {connections.length === 0 ? '暂无 SSH 连接，点击右上角 + 新建' : '无匹配连接'}
          </div>
        ) : filtered.map((c) => (
          <Fragment key={c.id}>
            <ListReorderPlaceholder listId={LIST_ID} itemId={c.id} />
            <SidebarItem
              active={c.id === selectedId}
              icon={<SshIcon size={iconSizes.row} />}
              title={c.name}
              tooltip={`${c.user ? `${c.user}@` : ''}${c.host}:${c.port ?? 22}；双击连接，右键编辑 / 删除，拖拽排序`}
              testId={`ssh-row-${c.id}`}
              reorderItemId={c.id}
              reorderKind="ssh"
              tabIndex={0}
              onClick={() => setSelectedId(c.id)}
              onDoubleClick={() => openConnection(c)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelectedId(c.id);
                setMenu({ x: event.clientX, y: event.clientY, conn: c });
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter') { event.preventDefault(); openConnection(c); }
                if (event.key === ' ') { event.preventDefault(); setSelectedId(c.id); }
              }}
              onPointerDown={(event) => startDrag(event, { id: c.id, kind: 'ssh' })}
              action={{
                icon: <Pencil size={iconSizes.compact} />,
                label: `编辑「${c.name}」`,
                onClick: () => { setSelectedId(c.id); editConn(c); },
              }}
            />
          </Fragment>
        ))}
        {filtered.length > 0 && (
          <ListReorderPlaceholder listId={LIST_ID} itemId={filtered[filtered.length - 1]!.id} after />
        )}
      </div>

      <ListReorderPreview>
        {() => <SshIcon size={iconSizes.row} />}
      </ListReorderPreview>

      {/* 右键菜单：编辑 / 删除 */}
      {menu && (
        <ContextMenu
          anchor={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
          items={[
            { label: '编辑', onClick: () => editConn(menu.conn) },
            { label: '删除', danger: true, onClick: () => void removeConn(menu.conn) },
          ]}
        />
      )}

      <SshFormModal open={formOpen} initial={editing} onClose={() => setFormOpen(false)} />
      <SshFormModal open={quickOpen} initial={null} onClose={() => setQuickOpen(false)} onConnect={conn => {
        useSessionStore.getState().addTab({ kind: 'ssh', ssh: { ...connectionTarget(conn), connectionId: undefined } });
      }} />
    </div>
  );
}
