import { useEffect, useMemo, useState } from 'react';
import { iconSizes, Pencil, Plus, Search, Server  } from '@ui/icons';
import { ask } from '@tauri-apps/plugin-dialog';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { useSessionStore } from '@features/workspace';
import ContextMenu from '@ui/ContextMenu';
import { IconBtn } from '@ui/UiBtn';
import { sidebarRowSpacing, sidebarRowContent, sidebarRowIcon, sidebarRowTitle } from '@ui/sidebarRow';
import type { SshConnection } from '@features/ssh/services/api';
import { connectionTarget } from '@features/ssh/services/api';
import SshFormModal from '@features/ssh/components/SshFormModal';

/**
 * PanelSsh — SSH 远程连接管理侧栏。
 * 顶栏：搜索（按名字过滤）+ 编辑当前选中 + 新建。
 * 列表：已有连接；点击创建活跃会话（终端标签页），文件面板随后连到远程。
 */
export default function PanelSsh() {
  const connections = useSshStore((s) => s.connections);
  const touch = useSshStore((s) => s.touch);
  const remove = useSshStore((s) => s.remove);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
      {/* 连接列表 */}
      <div className="scroll-region" style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
            {connections.length === 0 ? '暂无 SSH 连接，点击右上角 + 新建' : '无匹配连接'}
          </div>
        ) : filtered.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            onDoubleClick={() => openConnection(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelectedId(c.id);
              setMenu({ x: e.clientX, y: e.clientY, conn: c });
            }}
            data-testid={`ssh-row-${c.id}`}
            title={`${c.user ? `${c.user}@` : ''}${c.host}:${c.port ?? 22}；双击连接，右键编辑 / 删除`}
            tabIndex={0}
            onKeyDown={e => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter') { e.preventDefault(); openConnection(c); }
              if (e.key === ' ') { e.preventDefault(); setSelectedId(c.id); }
            }}
            style={sidebarRowSpacing}
            onMouseEnter={() => setHoveredId(c.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div style={{
              ...sidebarRowContent,
              color: c.id === selectedId ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: c.id === selectedId ? 'var(--selection-bg)' : hoveredId === c.id ? 'var(--hover)' : 'transparent',
            }}>
              <span style={sidebarRowIcon}><Server size={iconSizes.row} /></span>
              <span style={{ ...sidebarRowTitle, flex: 1, minWidth: 0, fontWeight: c.id === selectedId ? 600 : 500 }}>{c.name}</span>
              <button data-subtle className="sidebar-row-action" aria-label={`编辑「${c.name}」`} onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setSelectedId(c.id); editConn(c); }} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, padding: 0, border: 'none', borderRadius: 4,
                flexShrink: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                opacity: c.id === selectedId || hoveredId === c.id ? 1 : 0,
                transition: 'opacity 0.12s ease',
              }}><Pencil size={iconSizes.compact} /></button>
            </div>
          </div>
        ))}
      </div>

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
