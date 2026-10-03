import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Server } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { useSessionStore } from '@features/workspace';
import { useDockStore } from '@features/workspace';
import ContextMenu from '@ui/ContextMenu';
import { IconBtn } from '@ui/UiBtn';
import type { SshConnection } from '@features/ssh/services/api';
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
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
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
      ssh: { name: conn.name, host: conn.host, user: conn.user, port: conn.port, connectionId: conn.id },
    });
    // 文件管理器自动连到远程机文件
    useDockStore.getState().openPanel('files');
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
        padding: '6px 8px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0,
          background: 'var(--chrome-field)',
          borderRadius: 'var(--radius-inner)', padding: '0 6px', height: 24,
        }}>
          <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 SSH 连接…"
            data-testid="ssh-search"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
            }}
          />
        </div>
        <IconBtn
          title={selected ? `编辑「${selected.name}」` : '编辑当前选中的连接'}
          disabled={!selected}
          data-testid="ssh-edit-btn"
          onClick={openEdit}
        >
          <Pencil size={14} />
        </IconBtn>
        <IconBtn title="新建 SSH 连接" data-testid="ssh-new-btn" onClick={openNew}>
          <Plus size={14} />
        </IconBtn>
      </div>

      {/* 连接列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
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
            title={`双击连接到 ${c.host}；右键编辑 / 删除`}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', cursor: 'pointer', fontSize: 12,
              color: c.id === selectedId ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: c.id === selectedId ? 'var(--selection-bg)' : 'transparent',
              minHeight: 34,
            }}
            onMouseEnter={(e) => {
              if (c.id !== selectedId) (e.currentTarget as HTMLElement).style.background = 'var(--hover)';
            }}
            onMouseLeave={(e) => {
              if (c.id !== selectedId) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <Server size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden' }}>
              <span style={{
                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.name}
              </span>
              <span style={{
                display: 'block', fontSize: 11, color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
              }}>
                {c.user ? `${c.user}@` : ''}{c.host}{c.port && c.port !== 22 ? `:${c.port}` : ''}
              </span>
            </span>
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
    </div>
  );
}
