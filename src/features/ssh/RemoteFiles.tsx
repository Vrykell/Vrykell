import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Folder, File, MoreHorizontal, LocateFixed, ArrowUp } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { sshFsList, sshDownload, sshRename, sshDelete, sshUpload } from './api';
import type { SshFsEntry } from './api';
import type { SshConnection } from './api';
import { ptyWrite } from '@/lib/pty';
import { loadConfig, remoteOpenCommand } from '@features/files/fileOpen';
import { useTerminalStore } from '@entities/terminal';
import { useSessionStore } from '@entities/session';
import { useToastStore } from '@/components/Toast';
import { IconBtn } from '@/components/UiBtn';
import ContextMenu, { type ContextMenuItem } from '@/components/ContextMenu';
import ConfirmDialog from '@/components/ConfirmDialog';
import DownloadManager from '@/downloads/DownloadManager';
import { compactPathSegments } from '@features/files/pathUtils';
import {
  useRemotePathStore,
  normalizeRemotePath,
  parentOfRemote,
  sshPaneIdFor,
  shellQuote,
} from './remotePath';

/** 待二次确认的操作：重命名（携带新名）或删除。 */
type RemoteConfirm =
  | { kind: 'rename'; entry: SshFsEntry; newName: string }
  | { kind: 'delete'; entry: SshFsEntry };

/**
 * RemoteFiles — SSH 标签页的文件面板。
 * 目录单击进入；文件**双击远程编辑**（在 SSH 终端里用编辑器打开，不下载到本地）。
 * 右键：重命名 / 下载到本地（含目录）/ 删除；顶栏「上传」多选上传文件、
 * 「上传文件夹」递归上传目录、「下载」进入下载管理页。
 */
export default function RemoteFiles({ conn }: { conn: SshConnection }) {
  // 面板路径 = 真实远程绝对路径（存 store 按连接 id）；null = 尚未定位（首次加载 home）
  const path = useRemotePathStore((s) => s.path[conn.id] ?? null);
  const setPath = (p: string | null) => useRemotePathStore.getState().set(conn.id, p);
  const [entries, setEntries] = useState<SshFsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: SshFsEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<SshFsEntry | null>(null);
  const [confirm, setConfirm] = useState<RemoteConfirm | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const load = useCallback((p: string | null) => {
    setLoading(true);
    setError(null);
    sshFsList(conn.id, p ?? undefined)
      .then((res) => {
        setEntries(res.entries);
        // 首次定位：请求 home 后拿到真实路径（如 /home/user），面板不再用 null 表示 home
        if (p === null && res.base) setPath(normalizeRemotePath(res.base));
      })
      .catch((e) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [conn.id]);

  useEffect(() => { load(path); }, [load, path]);
  // 操作后的刷新（重命名/删除/上传）
  const refresh = () => load(path);

  // 顶栏面包屑压缩：不换行，侧栏窄时省略高层级目录（必须在视图切换的提前返回之前）
  const segs = path ? path.split('/').filter(Boolean) : [];
  const crumbRef = useRef<HTMLDivElement>(null);
  const [crumbWidth, setCrumbWidth] = useState(0);
  useEffect(() => {
    const el = crumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCrumbWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showDownloads]);
  const maxChars = Math.max(4, Math.floor(crumbWidth / 6.6) - 10);
  const { visible: visibleCrumbs, hiddenCount } = useMemo(
    () => compactPathSegments(segs, (s) => '/' + s.join('/'), maxChars),
    [segs, maxChars],
  );

  // hooks 之后再做视图切换，避免「条件 hook」导致 React 报错
  if (showDownloads) return <DownloadManager onBack={() => setShowDownloads(false)} />;

  const currentDir = () => path ?? '';

  const remoteEdit = (entry: SshFsEntry) => {
    const activeId = useSessionStore.getState().activeId;
    const sid = useTerminalStore.getState().sessions[activeId];
    if (!sid) { toast('SSH 会话未就绪', 'info'); return; }
    const command = remoteOpenCommand(loadConfig(), entry.path);
    ptyWrite(sid, command).catch(() => {});
  };

  const doDownload = async (entry: SshFsEntry) => {
    toast(entry.is_dir ? '正在下载文件夹…' : '正在下载…', 'info');
    try {
      const localPath = await sshDownload(conn.id, entry.path);
      toast(`已下载到 ${localPath}`, 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const doRename = async (entry: SshFsEntry, newName: string) => {
    try {
      await sshRename(conn.id, entry.path, newName);
      toast('已重命名', 'success');
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const doDelete = async (entry: SshFsEntry) => {
    try {
      await sshDelete(conn.id, entry.path);
      toast('已删除', 'success');
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const doUpload = async () => {
    const selected = await open({ multiple: true, directory: false });
    const files = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter(Boolean);
    if (files.length === 0) return;
    toast(`开始上传 ${files.length} 个文件…`, 'info');
    let ok = 0;
    for (let i = 0; i < files.length; i += 1) {
      try {
        await sshUpload(conn.id, currentDir(), files[i]);
        ok += 1;
      } catch (e) {
        toast(`${files[i]}：${String((e as Error)?.message ?? e)}`, 'error');
      }
    }
    toast(ok === files.length ? `已上传 ${ok} 个文件` : `上传完成：${ok}/${files.length} 成功`, ok === files.length ? 'success' : 'error');
      refresh();
  };

  const doUploadDir = async () => {
    const selected = await open({ directory: true });
    const dir = Array.isArray(selected) ? selected[0] : selected;
    if (!dir) return;
    toast('正在上传文件夹…', 'info');
    try {
      await sshUpload(conn.id, currentDir(), dir);
      toast('已上传文件夹', 'success');
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  const onContextMenu = (e: React.MouseEvent, entry: SshFsEntry) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const buildMenuItems = (entry: SshFsEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: '重命名', onClick: () => setRenameTarget(entry) },
    ];
    items.push({ label: entry.is_dir ? '下载文件夹到本地' : '下载到本地', onClick: () => doDownload(entry) });
    items.push({ label: '删除', onClick: () => setConfirm({ kind: 'delete', entry }), danger: true });
    return items;
  };

  /** 内联重命名提交：空名或未改动直接取消，否则弹二次确认。 */
  const requestRename = (entry: SshFsEntry, newName: string) => {
    setRenameTarget(null);
    const name = newName.trim();
    if (!name || name === entry.name) return;
    setConfirm({ kind: 'rename', entry, newName: name });
  };

  const cancelRename = () => setRenameTarget(null);

  const goUp = () => {
    if (!path || path === '/') return;
    const p = parentOfRemote(path);
    if (p) setPath(p);
  };

  /** 同步：终端跟随文件管理器 —— 向 SSH 终端发送 cd 到面板当前目录。 */
  const syncToTerminal = async () => {
    if (!path) return;
    const paneId = sshPaneIdFor(conn.id);
    const sid = paneId ? useTerminalStore.getState().sessions[paneId] : null;
    if (!sid) { toast('SSH 会话未就绪', 'info'); return; }
    try {
      await ptyWrite(sid, `cd ${shellQuote(path)}\r`);
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };

  // 面包屑：真实路径层级（/ › home › user › …），根是顶层、home 是 /home/user

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      userSelect: 'none', background: 'var(--surface)',
    }}>
      {/* 顶栏：面包屑（不换行，窄时省略高层级）+ 操作按钮（右对齐） */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '6px 8px',
        fontSize: 11, minHeight: 30, flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        <div ref={crumbRef} style={{
          display: 'flex', alignItems: 'center', gap: 2,
          flex: 1, minWidth: 0, overflow: 'hidden',
        }}>
          <Crumb label="/" onClick={() => setPath('/')} active={path === '/'} />
          {hiddenCount > 0 && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
              <span title="已省略上级目录" style={{ color: 'var(--text-muted)', letterSpacing: 1 }}>…</span>
            </>
          )}
          {visibleCrumbs.map((c, i) => (
            <span key={c.full} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
              <Crumb label={c.seg} onClick={() => setPath(c.full)} active={i === visibleCrumbs.length - 1} />
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {path && path !== '/' && (
            <IconBtn
              title="上级目录"
              data-testid="remote-up-btn"
              onClick={goUp}
            >
              <ArrowUp size={14} />
            </IconBtn>
          )}
          <IconBtn
            title="终端切换到当前目录"
            data-testid="remote-sync-btn"
            onClick={() => void syncToTerminal()}
          >
            <LocateFixed size={14} />
          </IconBtn>
          <IconBtn
            title="更多操作"
            data-testid="remote-more-btn"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMoreMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <MoreHorizontal size={14} />
          </IconBtn>
        </div>
      </div>

      {/* 远程文件列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>连接中…</div>
        ) : error ? (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--error-light)', textAlign: 'center' }}>{error}</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>空目录</div>
        ) : entries.map((e) => (
          <RemoteRow
            key={e.path}
            entry={e}
            renaming={renameTarget?.path === e.path}
            onRenameCommit={requestRename}
            onRenameCancel={cancelRename}
            onClick={(entry) => entry.is_dir && setPath(entry.path)}
            onDoubleClick={(entry) => !entry.is_dir && remoteEdit(entry)}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={buildMenuItems(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {moreMenu && (
        <ContextMenu
          anchor={moreMenu}
          items={[
            { label: '上传文件', onClick: doUpload },
            { label: '上传文件夹', onClick: doUploadDir },
            { label: '下载管理', onClick: () => setShowDownloads(true) },
          ]}
          onClose={() => setMoreMenu(null)}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'delete' ? '确认删除' : '确认重命名'}
        message={
          confirm
            ? confirm.kind === 'delete'
              ? `确定要删除「${confirm.entry.name}」吗？远程删除不可恢复。`
              : `确定要将「${confirm.entry.name}」重命名为「${confirm.newName}」吗？`
            : undefined
        }
        danger={confirm?.kind === 'delete'}
        confirmLabel={confirm?.kind === 'delete' ? '删除' : '重命名'}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (!c) return;
          if (c.kind === 'delete') doDelete(c.entry);
          else doRename(c.entry, c.newName);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function RemoteRow({
  entry,
  renaming,
  onRenameCommit,
  onRenameCancel,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  entry: SshFsEntry;
  renaming: boolean;
  onRenameCommit: (entry: SshFsEntry, newName: string) => void;
  onRenameCancel: (entry: SshFsEntry) => void;
  onClick: (entry: SshFsEntry) => void;
  onDoubleClick: (entry: SshFsEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: SshFsEntry) => void;
}) {
  const [draft, setDraft] = useState(entry.name);
  const committedRef = useRef(false);

  useEffect(() => {
    if (renaming) {
      committedRef.current = false;
      setDraft(entry.name);
    }
  }, [renaming, entry.name]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onRenameCommit(entry, draft);
  };
  const cancel = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onRenameCancel(entry);
  };

  return (
    <div
      onClick={renaming ? undefined : () => onClick(entry)}
      onDoubleClick={renaming ? undefined : () => onDoubleClick(entry)}
      onContextMenu={renaming ? undefined : (ev) => onContextMenu(ev, entry)}
      title={renaming
        ? '输入新名称，回车确认，Esc 取消'
        : entry.is_dir ? `进入 ${entry.path}` : `双击在终端里编辑 ${entry.path}`}
      data-testid={`remote-file-${entry.name}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', fontSize: 12, cursor: renaming ? 'text' : 'pointer',
        color: entry.is_dir ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
      onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--hover)'; }}
      onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ width: 18, flexShrink: 0, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
        {entry.is_dir ? <Folder size={13} /> : <File size={13} />}
      </span>
      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') cancel();
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          data-testid="rename-input"
          style={{
            flex: 1, minWidth: 0,
            background: 'var(--canvas)', border: '1px solid var(--accent)',
            borderRadius: 3, padding: '0 4px', fontSize: 12,
            color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
        />
      ) : (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
          {entry.name}
        </span>
      )}
    </div>
  );
}

function Crumb({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <span onClick={onClick} style={{
      cursor: 'pointer', padding: '1px 4px', borderRadius: 3,
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      background: active ? 'var(--hover)' : 'transparent',
      fontFamily: 'var(--font-mono)', fontSize: 11,
    }}>{label}</span>
  );
}
