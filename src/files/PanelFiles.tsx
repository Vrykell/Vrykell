import { openPath } from '@tauri-apps/plugin-opener';
import {
  ArrowUp,
  ChevronRight,
  Download,
  Folder,
  HardDrive,
  LocateFixed,
  Star,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import ContextMenu, { type ContextMenuItem } from '@/components/ContextMenu';
import { useToastStore } from '@/components/Toast';
import { fmtSize, IconBtn } from '@/components/UiBtn';
import DownloadManager from '@/downloads/DownloadManager';
import { fileIcon } from '@/files/fileIcon';
import { openFile } from '@/files/fileOpen';
import { flattenVisible, type VisibleRow } from '@/files/fileTree';
import {
  type DiskEntry,
  type FsEntry,
  fileOpenWith,
  fsDelete,
  fsDisks,
  fsHome,
  fsList,
  fsRename,
} from '@/files/fs';
import {
  compactPathSegments,
  normPath,
  parentOf,
  pathSegments,
  segmentsToPath,
} from '@/files/pathUtils';
import { useWorkspaceDirsStore } from '@/files/workspaceDirs';
import { ptyWrite } from '@/services/tauri/pty';
import { firstLeaf, leaves as layoutLeaves } from '@/services/tauri/windowLayout';
import RemoteFiles from '@/ssh/RemoteFiles';
import { shellQuote } from '@/ssh/remotePath';
import { ensureSshLoaded, useSshStore } from '@/ssh/store';
import { useTerminalStore } from '@/store/terminal';
import { isSessionTab, useWorkspaceStore } from '@/store/workspace';

/** 待二次确认的操作：重命名（携带新名）或删除。 */
type ConfirmState =
  | { kind: 'rename'; entry: FsEntry; newName: string }
  | { kind: 'delete'; entry: FsEntry };

/**
 * PanelFiles — 文件面板入口。
 * 活跃标签页为 SSH 连接时切到远程文件浏览，否则走本地文件浏览。
 */
export default function PanelFiles() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const sshConnections = useSshStore((s) => s.connections);
  const sshLoaded = useSshStore((s) => s.loaded);
  useEffect(() => {
    ensureSshLoaded();
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId);
  const focusedSpec =
    activeTab && isSessionTab(activeTab)
      ? (layoutLeaves(activeTab.layout).find(
          (t) => t.id === focusedPaneId && sessions[focusedPaneId],
        ) ?? firstLeaf(activeTab.layout))
      : null;

  if (sshLoaded && focusedSpec?.kind === 'ssh' && focusedSpec.ssh?.connectionId) {
    const conn = sshConnections.find((c) => c.id === focusedSpec.ssh!.connectionId);
    if (conn) return <RemoteFiles conn={conn} />;
  }
  return <LocalFiles />;
}

/**
 * LocalFiles — 本地文件浏览面板。
 * 跟随活跃标签页 cwd 实时定位；目录单击展开（树形）、双击进入；
 * 文件**双击**在终端编辑器中打开（可配置模板，编辑器缺失自动降级）；
 * 路径面包屑、右键菜单（工作区管理 / 打开方式）、顶栏「下载」进入下载管理。
 *
 * 单击/双击无需计时器消歧：双击会先触发两次单击（展开→收起，净效果为零），
 * 随后的 dblclick 再进入目录。
 */
function LocalFiles() {
  const [path, setPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [expandedSet, setExpandedSet] = useState<ReadonlySet<string>>(new Set());
  const [childCache, setChildCache] = useState<Record<string, FsEntry[]>>({});
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: FsEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<FsEntry | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const workspaceDirs = useWorkspaceDirsStore();
  const addTab = useWorkspaceStore((s) => s.addTab);

  // ── 跟随聚焦终端的 cwd：切窗口 / 切换聚焦终端 / 终端 cd 都会实时定位 ──
  const focusedPaneId = useTerminalStore((s) => s.focusedPaneId);
  const sessions = useTerminalStore((s) => s.sessions);
  const focused = useWorkspaceStore((s) => {
    const at = s.tabs.find((x) => x.id === s.activeId);
    if (at && isSessionTab(at)) {
      const fp = focusedPaneId;
      if (fp && sessions[fp] && layoutLeaves(at.layout).some((t) => t.id === fp)) return fp;
      return firstLeaf(at.layout).id;
    }
    return s.activeId;
  });
  const activeCwd = useWorkspaceStore((s) => {
    const at = s.tabs.find((x) => x.id === s.activeId);
    if (at && isSessionTab(at)) {
      const spec = layoutLeaves(at.layout).find((t) => t.id === focused);
      return s.terminalCwds[focused] ?? spec?.cwd;
    }
    return undefined;
  });
  useEffect(() => {
    fsHome()
      .then((h) => setHomePath(normPath(h)))
      .catch(() => setHomePath(null));
  }, []);

  useEffect(() => {
    setPath(activeCwd ? normPath(activeCwd) : homePath);
  }, [focused, activeCwd, homePath]);

  // path === null 表示「此电脑」（磁盘卡片列表），否则是具体目录
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const load = useCallback((p: string | null) => {
    if (p === null) {
      setEntries([]);
      fsDisks()
        .then(setDisks)
        .catch(() => setDisks([]));
      return;
    }
    fsList(p)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    load(path);
  }, [path, load]);

  // ── 树形展开 ──

  const toggleExpand = useCallback(
    (entry: FsEntry) => {
      setExpandedSet((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      // 已缓存则收起再展开不重复请求
      if (childCache[entry.path]) return;
      fsList(entry.path)
        .then((children) => setChildCache((p) => ({ ...p, [entry.path]: children })))
        .catch(() => setChildCache((p) => ({ ...p, [entry.path]: [] })));
    },
    [childCache],
  );

  // 顶栏面包屑压缩：不换行，侧栏窄时省略高层级目录（必须在视图切换的提前返回之前）
  const crumbs = pathSegments(path ?? '');
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
    () => compactPathSegments(crumbs, (segs) => segmentsToPath(segs), maxChars),
    [crumbs, maxChars],
  );

  // hooks 之后再做视图切换，避免「条件 hook」导致 React 报错
  if (showDownloads) return <DownloadManager onBack={() => setShowDownloads(false)} />;

  /** 单击目录：立即展开/收起 */
  const handleDirClick = (entry: FsEntry) => toggleExpand(entry);

  /** 双击目录/盘符：进入（此前的两次单击已相互抵消，展开状态不变） */
  const handleDirDoubleClick = (entry: FsEntry) => {
    setPath(normPath(entry.path));
  };

  // ── 文件打开：默认新建标签页，在其中的终端编辑器打开（标签页意义已泛化） ──

  const openFileInTerminal = async (entry: FsEntry) => {
    const addToast = useToastStore.getState().addToast;
    // 先解析编辑器命令（Rust file_open），暂不写任何终端
    let command = '';
    try {
      const res = await openFile(entry.path, (cmd) => {
        command = cmd;
      });
      if (res.via === 'system') {
        // 系统默认应用打开（openFile 内部已 openPath）
        if (res.degraded) addToast('未找到可用的终端编辑器，已用系统默认应用打开', 'info');
        return;
      }
      if (res.fellBack) {
        addToast(`未找到配置的编辑器，已降级为 ${res.editor}`, 'info');
      }
    } catch (e) {
      addToast(String((e as Error)?.message ?? e), 'error');
      return;
    }
    if (!command) return;

    // 新建标签页，等 shell 就绪后写入编辑器命令
    const parentDir = parentOf(normPath(entry.path)) ?? undefined;
    const tabId = useWorkspaceStore.getState().addTab({ cwd: parentDir, title: entry.name });
    const sid = await waitForSession(tabId);
    if (sid) {
      ptyWrite(sid, command.endsWith('\n') ? command : command + '\n').catch(() => {});
    } else {
      addToast('终端启动超时，请重试', 'error');
    }
  };

  const rows = flattenVisible(entries, expandedSet, childCache);

  // ── 右键菜单 ──

  const isWorkspace = (entryPath: string) => workspaceDirs.contains(entryPath);

  const handleContextMenu = (e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const buildMenuItems = (entry: FsEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const inWorkspace = isWorkspace(entry.path);

    if (entry.is_dir) {
      if (inWorkspace) {
        items.push({
          label: '从工作区移除',
          onClick: () => {
            const ws = workspaceDirs.dirs.find((d) => d.path === entry.path);
            if (ws) workspaceDirs.remove(ws.id);
          },
        });
      } else {
        items.push({
          label: '添加到工作区',
          onClick: () => workspaceDirs.add(entry.path, entry.name),
        });
      }
      items.push({
        label: '在新标签页中打开',
        onClick: () => addTab({ cwd: entry.path, title: entry.name }),
      });
    } else {
      items.push({
        label: '使用终端编辑器打开',
        onClick: () => openFileInTerminal(entry),
      });
      items.push({
        label: '使用系统默认应用打开',
        onClick: () => openPath(entry.path).catch(() => {}),
      });
      items.push({
        label: '打开方式…',
        onClick: () =>
          fileOpenWith(entry.path).catch((e) =>
            useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'),
          ),
      });
    }

    items.push({ label: '复制路径', onClick: () => navigator.clipboard.writeText(entry.path) });
    items.push({ label: '重命名', onClick: () => setRenameTarget(entry) });
    items.push({
      label: '删除',
      danger: true,
      onClick: () => setConfirm({ kind: 'delete', entry }),
    });
    return items;
  };

  const doRename = (entry: FsEntry, newName: string) => {
    fsRename(entry.path, newName)
      .then(() => {
        useToastStore.getState().addToast('已重命名', 'success');
        load(path);
      })
      .catch((e) => useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'));
  };

  const doDelete = (entry: FsEntry) => {
    fsDelete(entry.path)
      .then(() => {
        useToastStore.getState().addToast('已移入回收站', 'success');
        load(path);
      })
      .catch((e) => useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'));
  };

  /** 内联重命名提交：空名或未改动直接取消，否则弹二次确认。 */
  const requestRename = (entry: FsEntry, newName: string) => {
    setRenameTarget(null);
    const name = newName.trim();
    if (!name || name === entry.name) return;
    setConfirm({ kind: 'rename', entry, newName: name });
  };

  const cancelRename = () => setRenameTarget(null);

  const goUp = () => {
    if (path === null) return;
    setPath(parentOf(path));
  };

  /** 同步：终端跟随文件管理器 —— 向聚焦的本地终端发送 cd 到面板当前目录。 */
  const syncToTerminal = async () => {
    if (!path) return;
    const sid = sessions[focused];
    if (!sid) {
      useToastStore.getState().addToast('终端会话未就绪', 'info');
      return;
    }
    try {
      await ptyWrite(sid, `cd ${shellQuote(path)}\r`);
    } catch (e) {
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        userSelect: 'none',
        background: 'var(--surface)',
      }}
    >
      {/* 顶栏：面包屑（不换行，窄时省略高层级）+ 操作按钮（右对齐） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '6px 8px',
          fontSize: 11,
          minHeight: 30,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        <div
          ref={crumbRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Crumb label="此电脑" onClick={() => setPath(null)} active={path === null} />
          {hiddenCount > 0 && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
              <span title="已省略上级目录" style={{ color: 'var(--text-muted)', letterSpacing: 1 }}>
                …
              </span>
            </>
          )}
          {visibleCrumbs.map((c, i) => (
            <span
              key={c.full}
              style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
            >
              <span style={{ color: 'var(--text-muted)' }}>›</span>
              <Crumb
                label={c.seg}
                onClick={() => setPath(c.full)}
                active={i === visibleCrumbs.length - 1}
              />
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <IconBtn
            title="终端切换到当前目录"
            data-testid="local-sync-btn"
            onClick={() => void syncToTerminal()}
          >
            <LocateFixed size={14} />
          </IconBtn>
          <IconBtn
            title="下载管理"
            data-testid="local-downloads-btn"
            onClick={() => setShowDownloads(true)}
          >
            <Download size={14} />
          </IconBtn>
          {/* 已在根目录/盘符根时无上级，隐藏返回按钮 */}
          {path !== null && parentOf(path) !== null && (
            <IconBtn title="上级目录" data-testid="local-up-btn" onClick={goUp}>
              <ArrowUp size={14} />
            </IconBtn>
          )}
        </div>
      </div>

      {/* 文件列表（树形）/ 此电脑（磁盘卡片） */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {path === null ? (
          disks.length === 0 ? (
            <div
              style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}
            >
              正在扫描磁盘…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 10px' }}>
              {disks.map((d) => (
                <DiskCard key={d.path} disk={d} onOpen={() => setPath(d.path)} />
              ))}
            </div>
          )
        ) : (
          <>
            {rows.map((row) => (
              <FileRow
                key={row.entry.path}
                row={row}
                inWorkspace={isWorkspace(row.entry.path)}
                renaming={renameTarget?.path === row.entry.path}
                onRenameCommit={requestRename}
                onRenameCancel={cancelRename}
                onRowClick={(entry) => entry.is_dir && handleDirClick(entry)}
                onRowDoubleClick={(entry) =>
                  entry.is_dir ? handleDirDoubleClick(entry) : openFileInTerminal(entry)
                }
                onChevronClick={toggleExpand}
                onContextMenu={handleContextMenu}
              />
            ))}
            {rows.length === 0 && (
              <div
                style={{
                  padding: 16,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}
              >
                空目录
              </div>
            )}
          </>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={buildMenuItems(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'delete' ? '确认删除' : '确认重命名'}
        message={
          confirm
            ? confirm.kind === 'delete'
              ? `确定要删除「${confirm.entry.name}」吗？删除后将移入系统回收站。`
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

// ── 磁盘卡片（「此电脑」视图） ──

/** 磁盘小卡片：图标 + 名称 + 可用容量；无底色、无装饰组件，单击进入。 */
function DiskCard({ disk, onOpen }: { disk: DiskEntry; onOpen: () => void }) {
  const total = disk.total_bytes;
  const free = disk.free_bytes;
  const pct =
    total > 0 ? Math.min(100, Math.round(((total - Math.max(0, total - free)) / total) * 100)) : 0;
  return (
    <div
      onClick={onOpen}
      title={`${disk.path} · 共 ${fmtSize(total)} · 已用 ${pct}%`}
      data-testid={`disk-card-${disk.name}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--hover)',
          color: 'var(--accent)',
        }}
      >
        <HardDrive size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {disk.name}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            marginTop: 1,
          }}
        >
          {total > 0 ? `${fmtSize(free)} 可用` : '—'}
        </div>
      </div>
    </div>
  );
}

// ── 文件行 ──

function FileRow({
  row,
  inWorkspace,
  renaming,
  onRenameCommit,
  onRenameCancel,
  onRowClick,
  onRowDoubleClick,
  onChevronClick,
  onContextMenu,
}: {
  row: VisibleRow;
  inWorkspace: boolean;
  renaming: boolean;
  onRenameCommit: (entry: FsEntry, newName: string) => void;
  onRenameCancel: (entry: FsEntry) => void;
  onRowClick: (entry: FsEntry) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onChevronClick: (entry: FsEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
}) {
  const { entry, depth, expanded } = row;
  const Icon = entry.is_dir ? (inWorkspace ? Star : Folder) : fileIcon(entry.name);
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
      onClick={renaming ? undefined : () => onRowClick(entry)}
      onDoubleClick={renaming ? undefined : () => onRowDoubleClick(entry)}
      onContextMenu={renaming ? undefined : (e) => onContextMenu(e, entry)}
      title={
        renaming
          ? '输入新名称，回车确认，Esc 取消'
          : entry.is_dir
            ? inWorkspace
              ? '工作区文件夹 · 单击展开，双击进入'
              : '单击展开，双击进入'
            : '双击在终端编辑器中打开'
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: `3px 10px 3px ${4 + depth * 14}px`,
        fontSize: 12,
        cursor: renaming ? 'text' : 'pointer',
        color: entry.is_dir
          ? inWorkspace
            ? 'var(--accent-warm)'
            : 'var(--text-primary)'
          : 'var(--text-secondary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {/* 展开 chevron —— 仅目录有；点击立即切换（无单双击歧义） */}
      <span
        onClick={
          entry.is_dir && !renaming
            ? (e) => {
                e.stopPropagation();
                onChevronClick(entry);
              }
            : undefined
        }
        style={{
          width: 14,
          flexShrink: 0,
          display: 'inline-flex',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          transition: 'transform 0.12s ease',
          transform: expanded ? 'rotate(90deg)' : 'none',
          visibility: entry.is_dir ? 'visible' : 'hidden',
        }}
      >
        <ChevronRight size={11} />
      </span>
      <span style={{ width: 20, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
        <Icon size={13} fill={entry.is_dir && inWorkspace ? 'currentColor' : 'none'} />
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
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          data-testid="rename-input"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--canvas)',
            border: '1px solid var(--accent)',
            borderRadius: 3,
            padding: '0 4px',
            fontSize: 12,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
        />
      ) : (
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: entry.is_dir ? 'var(--font-ui)' : 'var(--font-mono)',
          }}
        >
          {entry.name}
        </span>
      )}
    </div>
  );
}

// ── 等待新标签页的 PTY 会话就绪 ──

function waitForSession(tabId: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const sid = useTerminalStore.getState().sessions[`${tabId}#0`];
      if (sid) return resolve(sid);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(check, 50);
    };
    check();
  });
}

// ── 面包屑段 ──

function Crumb({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <span
      onClick={onClick}
      style={{
        cursor: 'pointer',
        padding: '1px 4px',
        borderRadius: 3,
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        background: active ? 'var(--hover)' : 'transparent',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
      }}
    >
      {label}
    </span>
  );
}
