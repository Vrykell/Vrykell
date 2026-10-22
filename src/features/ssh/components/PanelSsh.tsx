import { Fragment, useEffect, useMemo, useState } from 'react';
import { DataUsage, Download, iconSizes, Pencil, Plug, Plus } from '@ui/icons';
import { SshIcon } from '@ui/shellIcons';
import { ask } from '@tauri-apps/plugin-dialog';
import { t } from '@i18n';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { useSessionStore, terminalsOf } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import ContextMenu from '@ui/ContextMenu';
import { iconColorKey, iconColorCss, useIconColorStore } from '@config/iconColors';
import { HistoryColorChoices } from '@ui/HistoryColorPalette';
import { IconBtn } from '@ui/UiBtn';
import SidebarToolbar from '@ui/SidebarToolbar';
import SidebarItem from '@ui/sidebarItem';
import { ListReorderPlaceholder, ListReorderPreview, useListReorderDrag } from '@ui/listReorder';
import type { SshConnection } from '@features/ssh/services/api';
import { connectionTarget } from '@features/ssh/services/api';
import SshFormModal from '@features/ssh/components/SshFormModal';
import SshImportModal from '@features/ssh/components/SshImportModal';
import SshDashboard from './SshDashboard';

/** List id shared by the rows, their placeholders and the drag hook. */
const LIST_ID = 'ssh-connections';

/**
 * PanelSsh — SSH 远程连接管理侧栏。
 * 顶栏：搜索（按名字过滤）+ 编辑当前选中 + 新建。
 * 列表：已有连接；点击选中，双击创建活跃会话（终端标签页），拖拽排序。
 */
function openSshConnection(conn: SshConnection) {
  const workspace = useSessionStore.getState();
  const sessions = useTerminalStore.getState().sessions;
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'session') continue;
    const terms = terminalsOf(tab);
    if (!terms.some(term => term.kind === 'ssh' && term.ssh?.connectionId === conn.id)) continue;
    if (terms.some(term => sessions[term.id])) continue;
    workspace.closeTab(tab.id);
  }
  useSshStore.getState().touch(conn.id).catch(() => {});
  useSessionStore.getState().addTab({ kind: 'ssh', ssh: connectionTarget(conn) });
}

function SshManagementPanel({ onShowDashboard }: { onShowDashboard: () => void }) {
  const connections = useSshStore((s) => s.connections);
  const iconColors = useIconColorStore(state => state.colors);
  const remove = useSshStore((s) => s.remove);
  const reorder = useSshStore((s) => s.reorder);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<SshConnection | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; conn: SshConnection; trigger: HTMLElement } | null>(null);

  useEffect(() => { ensureSshLoaded(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter(c => [c.name, c.host, c.user].some(value => value?.toLowerCase().includes(q)));
  }, [connections, query]);

  useEffect(() => {
    if (selectedId) document.querySelector(`[data-testid="ssh-row-${selectedId}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, connections]);

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

  /**
   * 双击 = 重新连接：先关掉同一连接里已经没有活会话的页面（进程已退出 / 已断开，
   * 否则会留下一个「重新连接」按钮的失效页），再开一个全新的连接页。
   */
  const openConnection = (conn: SshConnection) => {
    setSelectedId(conn.id);
    openSshConnection(conn);
    // File browsing is an optional service and should not replace connection navigation.
  };

  const openNew = () => {
    setEditing(null);
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
      <SidebarToolbar search={{ value: query, onChange: event => setQuery(event.target.value),
        placeholder: t('Search SSH connections…'), 'data-testid': 'ssh-search' }}>
        <IconBtn title={t('Resource dashboard')} data-testid="ssh-dashboard-open" onClick={onShowDashboard}>
          <DataUsage size={iconSizes.control} />
        </IconBtn>
        <IconBtn title={t('ssh.quick.connect')} data-testid="ssh-quick-btn" onClick={() => setQuickOpen(true)}>
          <Plug size={iconSizes.control} />
        </IconBtn>
        <IconBtn title={t('ssh.import.open')} data-testid="ssh-import-btn" onClick={() => setImportOpen(true)}><Download size={iconSizes.control} /></IconBtn>
        <IconBtn title={t('New SSH connection')} data-testid="ssh-new-btn" onClick={openNew}><Plus size={iconSizes.control} /></IconBtn>
      </SidebarToolbar>
      {/* 连接列表：拖动时源行让位，落点用虚线占位 */}
      <div data-reorder-list={LIST_ID} className="scroll-region" style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
            {connections.length === 0 ? t('No SSH connections yet. Select + to create one.') : t('No matching connections')}
          </div>
        ) : filtered.map((c) => (
          <Fragment key={c.id}>
            <ListReorderPlaceholder listId={LIST_ID} itemId={c.id} />
            <SidebarItem
              active={c.id === selectedId}
              icon={<SshIcon size={iconSizes.row} style={{ color: iconColorCss(iconColors[iconColorKey('ssh', c.id)]) }} />}
              title={c.name}
              subtitle={[`${c.user ? `${c.user}@` : ''}${c.host}:${c.port ?? 22}`,
                c.lastOpenedAt ? t('Last connected {{date}}', { date: new Date(c.lastOpenedAt).toLocaleDateString() }) : undefined]
                .filter(Boolean).join(' · ')}
              subtitleFontFamily="var(--font-ui)"
              tooltip={`${c.user ? `${c.user}@` : ''}${c.host}:${c.port ?? 22}；双击连接，右键编辑 / 删除，拖拽排序`}
              testId={`ssh-row-${c.id}`}
              reorderItemId={c.id}
              reorderListId={LIST_ID}
              reorderKind="ssh"
              tabIndex={0}
              onClick={() => setSelectedId(c.id)}
              onDoubleClick={() => openConnection(c)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelectedId(c.id);
                setMenu({ x: event.clientX, y: event.clientY, conn: c, trigger: event.currentTarget });
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter') { event.preventDefault(); openConnection(c); }
                if (event.key === ' ') { event.preventDefault(); setSelectedId(c.id); }
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault(); setSelectedId(c.id);
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: rect.left, y: rect.bottom, conn: c, trigger: event.currentTarget });
                }
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

      <ListReorderPreview listId={LIST_ID}>
        {drag => <SshIcon size={iconSizes.row} style={{ color: iconColorCss(iconColors[iconColorKey('ssh', drag.id)]) }} />}
      </ListReorderPreview>

      {/* 右键菜单：编辑 / 删除 */}
      {menu && (
        <ContextMenu
          anchor={{ x: menu.x, y: menu.y, trigger: menu.trigger }}
          onClose={() => setMenu(null)}
          items={[
            { label: '编辑', group: 'edit', onClick: () => editConn(menu.conn) },
            { label: '删除', danger: true, onClick: () => void removeConn(menu.conn) },
          ]}
          footer={<>
            <div className="history-menu-color-label">{t('Icon color')}</div>
            <HistoryColorChoices menu label={t('Icon color')} value={iconColors[iconColorKey('ssh', menu.conn.id)] ?? null}
              testId="ssh-icon-color" onSelect={color => {
                useIconColorStore.getState().setColor(iconColorKey('ssh', menu.conn.id), color);
                menu.trigger.focus(); setMenu(null);
              }} />
          </>}
        />
      )}

      <SshFormModal open={formOpen} initial={editing} onClose={() => setFormOpen(false)} onSaved={conn => setSelectedId(conn.id)} onSaveAndConnect={openConnection} />
      <SshImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={conn => setSelectedId(conn.id)} />
      <SshFormModal open={quickOpen} initial={null} onClose={() => setQuickOpen(false)} onConnect={conn => {
        useSessionStore.getState().addTab({ kind: 'ssh', ssh: { ...connectionTarget(conn), connectionId: undefined } });
      }} />
    </div>
  );
}

export default function PanelSsh({ active = true }: { active?: boolean }) {
  const [view, setView] = useState<'dashboard' | 'manage'>(() => {
    try { return localStorage.getItem('vrykell-ssh-workspace-view') === 'manage' ? 'manage' : 'dashboard'; }
    catch { return 'dashboard'; }
  });
  useEffect(() => {
    try { localStorage.setItem('vrykell-ssh-workspace-view', view); } catch { /* Preferences are optional. */ }
  }, [view]);
  return view === 'dashboard'
    ? <SshDashboard active={active} onManage={() => setView('manage')} onOpenTerminal={openSshConnection} />
    : <SshManagementPanel onShowDashboard={() => setView('dashboard')} />;
}
