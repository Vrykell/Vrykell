import { Fragment, useEffect, useState, useRef, useMemo } from 'react';
import { iconSizes, Star, Folder, ChevronRight, Download, FolderArrowRight, ArrowUp, HardDrive } from '@ui/icons';
import { type FsEntry, type DiskEntry } from '@features/files/services/fs';
import { fileIcon } from '@features/files/utils/fileIcon';
import { pathSegments, segmentsToPath, compactPathSegments } from '@features/files/utils/pathUtils';
import { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
import { IconBtn, fmtSize } from '@ui/UiBtn';
import { flattenVisible, type VisibleRow } from '@features/files/utils/fileTree';
import ContextMenu from '@ui/ContextMenu';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import RemoteFiles from '@features/ssh/components/RemoteFiles';
import ConfirmDialog from '@ui/ConfirmDialog';
import DownloadManager from '@features/files/components/DownloadManager';
import { useLocalFileBrowser } from '@features/files/hooks/useLocalFileBrowser';
import { useLocalFileActions } from '@features/files/hooks/useLocalFileActions';
import { useDockStore } from '@features/workspace';

/**
 * PanelFiles — 文件面板入口。
 * 活跃标签页为 SSH 连接时切到远程文件浏览，否则走本地文件浏览。
 */
export default function PanelFiles() {
  const { focusedSpec } = useActiveWorkspace();
  const sshConnections = useSshStore((s) => s.connections);
  const sshLoaded = useSshStore((s) => s.loaded);
  const filesOpen = useDockStore(s => (s.leftPanels.includes('files') || s.rightPanels.includes('files')) && !s.collapsedPanels.includes('files'));
  useEffect(() => { ensureSshLoaded(); }, []);

  if (sshLoaded && focusedSpec?.kind === 'ssh' && focusedSpec.ssh?.connectionId) {
    const conn = sshConnections.find((c) => c.id === focusedSpec.ssh!.connectionId);
    if (conn) return <RemoteFiles key={conn.id} conn={conn} enabled={filesOpen} />;
  }
  return <LocalFiles />;
}

/** Browse local files; opening an editor keeps the directory, expanded tree and scroll intact. */
function LocalFiles() {
  const [showDownloads, setShowDownloads] = useState(false);

  // Seed the browser from the terminal once, then keep navigation independent.
  const { focusedPaneId: focused, activeCwd, sessions } = useActiveWorkspace();
  const {
    path,
    navigate,
    goBack,
    canGoBack,
    selectedPath,
    setSelectedPath,
    scrollRef,
    entries,
    disks,
    expandedSet,
    childCache,
    loading,
    error,
    childErrors,
    childLoading,
    load,
    toggleExpand,
    retryExpand,
  } = useLocalFileBrowser({ initialCwd: activeCwd });
  const {
    ctxMenu,
    renameTarget,
    confirm,
    closeContextMenu,
    cancelConfirm,
    isWorkspace,
    openFileInTerminal,
    handleContextMenu,
    buildMenuItems,
    requestRename,
    cancelRename,
    confirmAction,
    syncToTerminal,
  } = useLocalFileActions({ path, load, focusedPaneId: focused, sessions });

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

  /** 单击只选中；进入目录 / 打开文件都由双击触发 */
  const handleRowClick = (entry: FsEntry) => {
    setSelectedPath(entry.path);
  };

  /** 右键同时选中目标行，保持菜单作用于当前选中项 */
  const handleRowContextMenu = (event: React.MouseEvent, entry: FsEntry) => {
    setSelectedPath(entry.path);
    handleContextMenu(event, entry);
  };

  const rows = flattenVisible(entries, expandedSet, childCache);

  /** 进入目录 / 打开文件 —— 双击与 Enter 共用 */
  const activateEntry = (entry: FsEntry) => {
    if (entry.is_dir) navigate(entry.path);
    else void openFileInTerminal(entry);
  };

  /** ↑/↓ 在可见行之间移动选中并把目标行滚动到可见区域，Enter 进入目录 / 打开文件 */
  const handleTreeKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length === 0) return;
      event.preventDefault();
      const currentIndex = rows.findIndex((row) => row.entry.path === selectedPath);
      const nextIndex = event.key === 'ArrowDown'
        ? (currentIndex < 0 ? 0 : Math.min(rows.length - 1, currentIndex + 1))
        : (currentIndex < 0 ? rows.length - 1 : Math.max(0, currentIndex - 1));
      const nextPath = rows[nextIndex]!.entry.path;
      setSelectedPath(nextPath);
      const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-testid="file-row"]') ?? [])
        .find((element) => element.dataset.path === nextPath);
      target?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (event.key === 'Enter') {
      const selected = rows.find((row) => row.entry.path === selectedPath);
      if (!selected) return;
      event.preventDefault();
      activateEntry(selected.entry);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      userSelect: 'none', background: 'transparent',
    }}>
      {/* 顶栏：面包屑（不换行，窄时省略高层级）+ 操作按钮（右对齐） */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '6px 8px',
        fontSize: 'calc(11px * var(--ui-font-scale))', minHeight: 30, flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        <div ref={crumbRef} style={{
          display: 'flex', alignItems: 'center', gap: 2,
          flex: 1, minWidth: 0, overflow: 'hidden',
        }}>
          <Crumb label="此电脑" onClick={() => navigate(null)} active={path === null} />
          {hiddenCount > 0 && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
              <span title="已省略上级目录" style={{ color: 'var(--text-muted)', letterSpacing: 1 }}>…</span>
            </>
          )}
          {visibleCrumbs.map((c, i) => (
            <span key={c.full} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
              <Crumb label={c.seg} onClick={() => navigate(c.full)} active={i === visibleCrumbs.length - 1} />
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <IconBtn
            title="终端切换到当前目录"
            data-testid="local-sync-btn"
            onClick={() => void syncToTerminal()}
          >
            <FolderArrowRight size={iconSizes.control} />
          </IconBtn>
          <IconBtn
            title="下载管理"
            data-testid="local-downloads-btn"
            onClick={() => setShowDownloads(true)}
          >
            <Download size={iconSizes.control} />
          </IconBtn>
          {/* Back = the previous tree view snapshot (expanded rows, selection, scroll), not the parent folder */}
          <IconBtn
            title="回到上一个视图"
            data-testid="local-back-btn"
            disabled={!canGoBack}
            onClick={goBack}
          >
            <ArrowUp size={iconSizes.control} />
          </IconBtn>
        </div>
      </div>

      {/* 文件列表（树形）/ 此电脑（磁盘卡片） */}
      <div
        className="scroll-region"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        data-testid="local-file-tree"
        data-path={path ?? ''}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
      >
        {loading ? (
          <div role="status" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>
            {path === null ? '正在扫描磁盘…' : '正在读取目录…'}
          </div>
        ) : error ? (
          <div role="alert" style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 'var(--fs-label)' }}>
            <div>{error}</div>
            <button onClick={() => load(path)} style={{ marginTop: 10, minHeight: 32 }}>重试</button>
          </div>
        ) : path === null ? (
          disks.length === 0 ? (
            <div style={{ padding: 16, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', textAlign: 'center' }}>
              暂无可用磁盘
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 10px' }}>
              {disks.map((d) => (
                <DiskCard key={d.path} disk={d} onOpen={() => navigate(d.path)} />
              ))}
            </div>
          )
        ) : (
          <>
            {rows.map((row) => (
              <Fragment key={row.entry.path}>
                <FileRow
                  row={row}
                  selected={selectedPath === row.entry.path}
                  inWorkspace={isWorkspace(row.entry.path)}
                  renaming={renameTarget?.path === row.entry.path}
                  onRenameCommit={requestRename}
                  onRenameCancel={cancelRename}
                  onRowClick={handleRowClick}
                  onRowDoubleClick={activateEntry}
                  onRowContextMenu={handleRowContextMenu}
                  onChevronClick={toggleExpand}
                />
                {row.expanded && childLoading.has(row.entry.path) && (
                  <div role="status" style={{ padding: '4px 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>正在读取目录…</div>
                )}
                {row.expanded && childErrors[row.entry.path] && (
                  <div role="alert" style={{ padding: '4px 12px', color: 'var(--text-secondary)', fontSize: 'var(--fs-label)' }}>
                    {childErrors[row.entry.path]}
                    <button onClick={() => retryExpand(row.entry)} style={{ marginLeft: 8, minHeight: 32 }}>重试</button>
                  </div>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <div style={{ padding: 16, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', textAlign: 'center' }}>
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
          onClose={closeContextMenu}
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
        onConfirm={confirmAction}
        onCancel={cancelConfirm}
      />
    </div>
  );
}

// ── 磁盘卡片（「此电脑」视图） ──

/** 磁盘小卡片：图标 + 名称 + 可用容量；无底色、无装饰组件，单击进入。 */
function DiskCard({ disk, onOpen }: { disk: DiskEntry; onOpen: () => void }) {
  const total = disk.total_bytes;
  const free = disk.free_bytes;
  const pct = total > 0 ? Math.min(100, Math.round(((total - Math.max(0, total - free)) / total) * 100)) : 0;
  return (
    <div
      onClick={onOpen}
      title={`${disk.path} · 共 ${fmtSize(total)} · 已用 ${pct}%`}
      data-testid={`disk-card-${disk.name}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 10px', borderRadius: 8,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--hover)', color: 'var(--accent)',
      }}>
        <HardDrive size={iconSizes.row} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {disk.name}
        </div>
        <div style={{
          fontSize: 'calc(10.5px * var(--ui-font-scale))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
          marginTop: 1,
        }}>
          {total > 0 ? `${fmtSize(free)} 可用` : '—'}
        </div>
      </div>
    </div>
  );
}

// ── 文件行 ──

function FileRow({
  row,
  selected,
  inWorkspace,
  renaming,
  onRenameCommit,
  onRenameCancel,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onChevronClick,
}: {
  row: VisibleRow;
  selected: boolean;
  inWorkspace: boolean;
  renaming: boolean;
  onRenameCommit: (entry: FsEntry, newName: string) => void;
  onRenameCancel: (entry: FsEntry) => void;
  onRowClick: (entry: FsEntry) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onRowContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
  onChevronClick: (entry: FsEntry) => void;
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

  const restingBackground = selected ? 'var(--selection-bg)' : 'transparent';

  return (
    <div
      onClick={renaming ? undefined : () => onRowClick(entry)}
      onDoubleClick={renaming ? undefined : () => onRowDoubleClick(entry)}
      onContextMenu={renaming ? undefined : (e) => onRowContextMenu(e, entry)}
      title={renaming
        ? '输入新名称，回车确认，Esc 取消'
        : entry.is_dir
          ? (inWorkspace ? '工作区文件夹 · 单击选中，双击进入' : '单击选中，双击进入')
          : '单击选中，双击在终端编辑器中打开'}
      data-testid="file-row"
      data-path={entry.path}
      data-selected={selected ? 'true' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: `5px 10px 5px ${4 + depth * 14}px`,
        fontSize: 'var(--fs-label)', lineHeight: '20px', minHeight: 32,
        cursor: renaming ? 'text' : 'pointer',
        background: restingBackground,
        color: entry.is_dir
          ? (inWorkspace ? 'var(--accent-warm)' : 'var(--text-primary)')
          : 'var(--text-secondary)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = selected ? 'var(--selection-bg)' : 'var(--hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = restingBackground; }}
    >
      {/* 展开 chevron —— 仅目录有；展开/收起只由它负责 */}
      <span
        onClick={entry.is_dir && !renaming ? (e) => { e.stopPropagation(); onChevronClick(entry); } : undefined}
        data-testid="file-row-expander"
        style={{
          width: iconSizes.compact, flexShrink: 0, display: 'inline-flex', justifyContent: 'center',
          color: 'var(--text-muted)',
          transition: 'transform 0.12s ease',
          transform: expanded ? 'rotate(90deg)' : 'none',
          visibility: entry.is_dir ? 'visible' : 'hidden',
        }}
      >
        <ChevronRight size={iconSizes.compact} />
      </span>
      <span style={{ width: 20, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
        <Icon size={iconSizes.row} fill={entry.is_dir && inWorkspace ? 'currentColor' : 'none'} />
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
            borderRadius: 3, padding: '0 4px', fontSize: 'calc(12px * var(--ui-font-scale))',
            color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
        />
      ) : (
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: entry.is_dir ? 'var(--font-ui)' : 'var(--font-mono)',
        }}>
          {entry.name}
        </span>
      )}
    </div>
  );
}

// ── 面包屑段 ──

function Crumb({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <span onClick={onClick} style={{
      cursor: 'pointer', padding: '1px 4px', borderRadius: 3,
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      background: active ? 'var(--hover)' : 'transparent',
      fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-font-scale))',
    }}>{label}</span>
  );
}
