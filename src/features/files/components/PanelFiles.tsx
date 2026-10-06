import { Fragment, useEffect, useState, useRef, useMemo } from 'react';
import { iconSizes, Star, Folder, ChevronRight, FolderArrowRight, ArrowUp, HardDrive, MoreHorizontal } from '@ui/icons';
import { type FsEntry, type DiskEntry } from '@platform/api/fs';
import { fileIcon } from '@features/files/utils/fileIcon';
import { normPath, pathSegments, segmentsToPath, parentOf } from '@platform/path';
import { compactPathSegments } from '@features/files/utils/breadcrumb';
import { useFileRowDrag } from '@features/files/hooks/useFileRowDrag';
import { useExternalFileDrop } from '@features/files/hooks/useExternalFileDrop';
import { useFileDragStore } from '@features/files';
import FileDragPreview from '@features/files/components/FileDragPreview';
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
import { useDockStore, useSessionStore } from '@features/workspace';

/** Hint shown on the current-path crumb that switches the breadcrumb into an editable path. */
const EDIT_PATH_HINT = '单击编辑路径，回车跳转';

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
    selection,
    anchorPath,
    selectOnly,
    toggleSelection,
    replaceSelection,
    scrollRef,
    entries,
    disks,
    expandedSet,
    childCache,
    loadedPath,
    loadingHint,
    error,
    childErrors,
    childLoadingHint,
    load,
    toggleExpand,
    retryExpand,
  } = useLocalFileBrowser({ initialCwd: activeCwd });

  const rows = flattenVisible(entries, expandedSet, childCache);

  /** The current path's listing has settled; empty states wait for it so loads never flash placeholders. */
  const settled = loadedPath === path;

  /** 右键菜单的目标行：命中行属于多选时是整组，否则只有该行。 */
  const targetsFor = (entry: FsEntry): FsEntry[] => {
    if (!selection.has(entry.path)) return [entry];
    const byPath = new Map<string, FsEntry>();
    for (const row of rows) {
      if (selection.has(row.entry.path)) byPath.set(row.entry.path, row.entry);
    }
    return byPath.size > 0 ? [...byPath.values()] : [entry];
  };

  const {
    ctxMenu,
    renameTarget,
    confirm,
    clipboard,
    cutPaths,
    undo,
    undoCount,
    closeContextMenu,
    cancelConfirm,
    isWorkspace,
    openFileInTerminal,
    handleContextMenu,
    buildMenuItems,
    requestRename,
    cancelRename,
    confirmAction,
    runUndo,
    syncToTerminal,
    copySelection,
    cutSelection,
    pasteClipboard,
    transferInto,
  } = useLocalFileActions({
    path,
    load,
    focusedPaneId: focused,
    sessions,
    targetsFor,
    onSelectionChange: (paths) => replaceSelection(paths),
    // 有内容被移入已展开的子文件夹时，重新读取它的子列表
    onFolderMutated: (folderPath) => {
      if (childCache[folderPath] !== undefined) {
        retryExpand({ name: pathSegments(folderPath).pop() ?? folderPath, path: folderPath, is_dir: true });
      }
    },
  });

  // 顶栏面包屑压缩：不换行，侧栏窄时省略高层级目录（必须在视图切换的提前返回之前）
  const crumbs = pathSegments(path ?? '');
  const crumbRef = useRef<HTMLDivElement>(null);
  const [crumbWidth, setCrumbWidth] = useState(0);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
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

  /** Turn the breadcrumb into an editable full path: text selected, Enter navigates, Esc / blur cancels. */
  const beginPathEdit = () => setPathDraft(path ?? '');
  const cancelPathEdit = () => setPathDraft(null);
  const commitPathEdit = () => {
    // Accept paths copied with surrounding quotes ("Copy as path" style).
    const next = (pathDraft ?? '').trim().replace(/^"(.*)"$/, '$1');
    cancelPathEdit();
    if (!next || next === path) return;
    navigate(normPath(next));
  };

  /** Open the more-actions menu anchored to its button. */
  const openMoreMenu = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreMenu({ x: rect.left, y: rect.bottom + 4 });
  };
  const closeMoreMenu = () => setMoreMenu(null);

  /** Open a new local session tab rooted at the folder currently browsed. */
  const openTabAtCurrentFolder = () => {
    if (path === null) return;
    useSessionStore.getState().addTab({ cwd: path, title: pathSegments(path).pop() ?? path });
  };

  /** 空白处右键：粘贴 / 新建标签页；没有任何可执行项时不弹菜单 */
  const handleTreeContextMenu = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('[data-testid="file-row"]')) return;
    if (!clipboard && path === null) return;
    event.preventDefault();
    setBlankMenu({ x: event.clientX, y: event.clientY });
  };

  /** 拖动到目标目录：只做移动；不把文件夹放进自身子树，也不做同目录移动 */
  const startRowDrag = useFileRowDrag((items, target) => {
    const paths = items.map((item) => item.path);
    const targetDir = target.dir;
    if (paths.some((p) => targetDir === p || targetDir.startsWith(`${p}/`))) return;
    if (targetDir === path) return;
    if (paths.every((p) => parentOf(p) === targetDir)) return;
    void transferInto(paths, targetDir, 'move');
  });
  const dragTarget = useFileDragStore((state) => state.target);
  const dragItems = useFileDragStore((state) => state.items);

  /** 拖拽从指针按下的行开始：命中选中集时拖动整组 */
  const handleRowPointerDown = (event: React.PointerEvent<HTMLElement>, entry: FsEntry) => {
    const picked = selection.has(entry.path)
      ? rows.filter((row) => selection.has(row.entry.path)).map((row) => row.entry)
      : [entry];
    startRowDrag(event, picked.map((item) => ({ path: item.path, name: item.name, is_dir: item.is_dir })));
  };

  /** 系统文件拖入：命中文件夹行/文件行（同级目录），落在空白处 = 当前目录（移动进面板） */
  const [externalDrop, setExternalDrop] = useState<{ rowPath: string | null; dir: string } | null>(null);
  useExternalFileDrop({
    resolveTarget: (x, y) => {
      const tree = scrollRef.current;
      if (!tree) return null;
      const rect = tree.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
      const zone = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-dir]');
      const dir = zone && tree.contains(zone) ? zone.dataset.dropDir ?? null : null;
      if (dir) return { rowPath: zone!.dataset.path ?? null, dir };
      return path === null ? null : { rowPath: null, dir: path };
    },
    onHover: setExternalDrop,
    onDrop: (paths, target) => { void transferInto(paths, target.dir, 'move'); },
  });

  /** 行是否显示为放置目标：内部拖拽要求目标有效，外部拖入只看命中行 */
  const isDropTarget = (row: VisibleRow) => {
    if (dragTarget?.rowPath === row.entry.path) {
      const dir = dragTarget.dir;
      const invalid = dir === path || dragItems.some((item) => dir === item.path || dir.startsWith(`${item.path}/`));
      if (!invalid) return true;
    }
    return externalDrop?.rowPath === row.entry.path;
  };

  /** 单击选中；Shift 连选、Ctrl/Cmd 加选；双击进入目录 / 打开文件由双击触发 */
  const handleRowClick = (entry: FsEntry, event: React.MouseEvent) => {
    if (event.shiftKey && anchorPath !== null) {
      const from = rows.findIndex((row) => row.entry.path === anchorPath);
      const to = rows.findIndex((row) => row.entry.path === entry.path);
      if (from >= 0 && to >= 0) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        replaceSelection(rows.slice(start, end + 1).map((row) => row.entry.path), anchorPath);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      toggleSelection(entry.path);
      return;
    }
    selectOnly(entry.path);
  };

  /** 右键：命中的行不在选中集内时改为只选中它，菜单始终作用于整个选中集 */
  const handleRowContextMenu = (event: React.MouseEvent, entry: FsEntry) => {
    if (!selection.has(entry.path)) selectOnly(entry.path);
    handleContextMenu(event, entry);
  };

  /** 进入目录 / 打开文件 —— 双击与 Enter 共用 */
  const activateEntry = (entry: FsEntry) => {
    if (entry.is_dir) navigate(entry.path);
    else void openFileInTerminal(entry);
  };

  /** ↑/↓ 在可见行之间移动光标并把目标行滚动到可见区域，Enter 进入目录 / 打开文件 */
  const handleTreeKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;

    // 剪贴板快捷键（右键菜单的等价入口）
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'x' || event.key === 'v')) {
      event.preventDefault();
      if (event.key === 'v') {
        void pasteClipboard();
        return;
      }
      const anchorEntry = rows.find((row) => row.entry.path === anchorPath)?.entry;
      if (!anchorEntry) return;
      const targets = targetsFor(anchorEntry);
      if (event.key === 'c') copySelection(targets);
      else cutSelection(targets);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length === 0) return;
      event.preventDefault();
      const currentIndex = rows.findIndex((row) => row.entry.path === anchorPath);
      const nextIndex = event.key === 'ArrowDown'
        ? (currentIndex < 0 ? 0 : Math.min(rows.length - 1, currentIndex + 1))
        : (currentIndex < 0 ? rows.length - 1 : Math.max(0, currentIndex - 1));
      const nextPath = rows[nextIndex]!.entry.path;
      selectOnly(nextPath);
      const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-testid="file-row"]') ?? [])
        .find((element) => element.dataset.path === nextPath);
      target?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (event.key === 'Enter') {
      const selected = rows.find((row) => row.entry.path === anchorPath);
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
        <div
          ref={crumbRef}
          data-testid="crumb-bar"
          onClick={pathDraft === null ? beginPathEdit : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 2,
            flex: 1, minWidth: 0, overflow: 'hidden',
            cursor: pathDraft === null ? 'text' : undefined,
          }}
        >
          {pathDraft === null ? (
            <>
              <Crumb
                label="此电脑"
                onClick={path === null ? beginPathEdit : () => navigate(null)}
                active={path === null}
                title={path === null ? EDIT_PATH_HINT : undefined}
              />
              {hiddenCount > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>›</span>
                  <span title="已省略上级目录" style={{ color: 'var(--text-muted)', letterSpacing: 1 }}>…</span>
                </>
              )}
              {visibleCrumbs.map((c, i) => {
                const isCurrent = i === visibleCrumbs.length - 1;
                return (
                  <span key={c.full} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <span style={{ color: 'var(--text-muted)' }}>›</span>
                    <Crumb
                      label={c.seg}
                      onClick={isCurrent ? beginPathEdit : () => navigate(c.full)}
                      active={isCurrent}
                      title={isCurrent ? EDIT_PATH_HINT : undefined}
                      dropPath={isCurrent ? undefined : c.full}
                    />
                  </span>
                );
              })}
            </>
          ) : (
            <input
              autoFocus
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') commitPathEdit();
                else if (event.key === 'Escape') cancelPathEdit();
              }}
              onBlur={cancelPathEdit}
              onClick={(event) => event.stopPropagation()}
              spellCheck={false}
              aria-label="编辑路径"
              data-testid="path-input"
              style={{
                flex: 1, minWidth: 0, height: 22, padding: '0 6px',
                background: 'var(--chrome-field)', border: '1px solid var(--border-strong)',
                borderRadius: 4, outline: 'none',
                fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-font-scale))',
                color: 'var(--text-primary)',
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <IconBtn
            title="终端切换到当前目录"
            data-testid="local-sync-btn"
            onClick={() => void syncToTerminal()}
          >
            <FolderArrowRight size={iconSizes.control} />
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
          {/* 本地可用的操作都收进更多菜单（本地没有上传能力，菜单里不出现上传项） */}
          <IconBtn
            title="更多操作"
            data-testid="local-more-btn"
            onClick={openMoreMenu}
          >
            <MoreHorizontal size={iconSizes.control} />
          </IconBtn>
        </div>
      </div>

      {/* 文件列表（树形）/ 此电脑（磁盘卡片） */}
      <div
        className="scroll-region"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={handleTreeContextMenu}
        data-testid="local-file-tree"
        data-path={path ?? ''}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
      >
        {loadingHint ? (
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
            settled && (
              <div style={{ padding: 16, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', textAlign: 'center' }}>
                暂无可用磁盘
              </div>
            )
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
                  selected={selection.has(row.entry.path)}
                  cut={cutPaths.has(row.entry.path)}
                  dropTarget={isDropTarget(row)}
                  inWorkspace={isWorkspace(row.entry.path)}
                  renaming={renameTarget?.path === row.entry.path}
                  onRenameCommit={requestRename}
                  onRenameCancel={cancelRename}
                  onRowClick={handleRowClick}
                  onRowPointerDown={handleRowPointerDown}
                  onRowDoubleClick={activateEntry}
                  onRowContextMenu={handleRowContextMenu}
                  onChevronClick={toggleExpand}
                />
                {row.expanded && childLoadingHint.has(row.entry.path) && (
                  <div role="status" style={{ padding: '4px 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>正在读取目录…</div>
                )}
                {row.expanded && childErrors[row.entry.path] && (
                  <div role="alert" style={{ padding: '4px 12px', color: 'var(--text-secondary)', fontSize: 'var(--fs-label)' }}>
                    {childErrors[row.entry.path]}
                    <button onClick={() => retryExpand(row.entry)} style={{ marginLeft: 8, minHeight: 32 }}>重试</button>
                  </div>
                )}
                {row.expanded && childCache[row.entry.path]?.length === 0 && (
                  <div
                    data-testid="file-row-empty"
                    style={{
                      padding: `4px 10px 4px ${4 + (row.depth + 1) * 14}px`,
                      color: 'var(--text-muted)', fontSize: 'var(--fs-label)',
                    }}
                  >
                    空文件夹
                  </div>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && settled && (
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

      {moreMenu && (
        <ContextMenu
          anchor={moreMenu}
          items={[
            // 回退入口只在确实操作过文件后出现；历史栈可连续回退
            ...(undo ? [{
              label: `回退${undo.label}${undoCount > 1 ? `（共 ${undoCount} 步）` : ''}`,
              onClick: () => void runUndo(),
            }] : []),
            // 盘符视图没有「当前文件夹」，不显示不可用的新建标签页
            ...(path === null ? [] : [{ label: '从当前文件夹新建标签页', onClick: openTabAtCurrentFolder }]),
            { label: '下载管理', onClick: () => setShowDownloads(true) },
          ]}
          onClose={closeMoreMenu}
        />
      )}

      {blankMenu && (
        <ContextMenu
          anchor={blankMenu}
          items={[
            ...(clipboard
              ? [{ label: clipboard.mode === 'cut' ? '粘贴（移动）' : '粘贴', onClick: () => void pasteClipboard() }]
              : []),
            ...(path === null ? [] : [{ label: '从当前文件夹新建标签页', onClick: openTabAtCurrentFolder }]),
          ]}
          onClose={() => setBlankMenu(null)}
        />
      )}

      <FileDragPreview />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'delete' ? '确认删除' : '确认重命名'}
        message={
          confirm
            ? confirm.kind === 'delete'
              ? confirm.entries.length > 1
                ? `确定要删除选中的 ${confirm.entries.length} 项吗？删除后可在「更多 → 回退删除」恢复。`
                : `确定要删除「${confirm.entries[0]!.name}」吗？删除后可在「更多 → 回退删除」恢复。`
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
  cut,
  dropTarget,
  inWorkspace,
  renaming,
  onRenameCommit,
  onRenameCancel,
  onRowClick,
  onRowPointerDown,
  onRowDoubleClick,
  onRowContextMenu,
  onChevronClick,
}: {
  row: VisibleRow;
  selected: boolean;
  /** 已剪切待粘贴：淡显提示会被移走 */
  cut: boolean;
  /** 拖拽悬停在本文件夹上：高亮提示放置目标 */
  dropTarget: boolean;
  inWorkspace: boolean;
  renaming: boolean;
  onRenameCommit: (entry: FsEntry, newName: string) => void;
  onRenameCancel: (entry: FsEntry) => void;
  onRowClick: (entry: FsEntry, event: React.MouseEvent) => void;
  onRowPointerDown: (event: React.PointerEvent<HTMLElement>, entry: FsEntry) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onRowContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
  onChevronClick: (entry: FsEntry) => void;
}) {
  const { entry, depth, expanded, empty } = row;
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
      onClick={renaming ? undefined : (event) => onRowClick(entry, event)}
      onPointerDown={renaming ? undefined : (event) => onRowPointerDown(event, entry)}
      onDoubleClick={renaming ? undefined : () => onRowDoubleClick(entry)}
      onContextMenu={renaming ? undefined : (e) => onRowContextMenu(e, entry)}
      title={renaming
        ? '输入新名称，回车确认，Esc 取消'
        : entry.is_dir
          ? (inWorkspace ? '工作区文件夹 · 单击选中，双击进入，可拖入文件' : '单击选中，双击进入，可拖入文件')
          : '单击选中，双击在终端编辑器中打开'}
      data-testid="file-row"
      data-path={entry.path}
      data-selected={selected ? 'true' : undefined}
      data-drop-dir={renaming ? undefined : (entry.is_dir ? entry.path : parentOf(entry.path) ?? undefined)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: `5px 10px 5px ${4 + depth * 14}px`,
        fontSize: 'var(--fs-label)', lineHeight: '20px', minHeight: 32,
        cursor: renaming ? 'text' : 'pointer',
        background: dropTarget ? 'var(--accent-bg)' : restingBackground,
        opacity: cut ? 0.55 : 1,
        outline: dropTarget ? '1px solid var(--accent)' : undefined,
        outlineOffset: -1,
        color: entry.is_dir
          ? (inWorkspace ? 'var(--accent-warm)' : 'var(--text-primary)')
          : 'var(--text-secondary)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : selected ? 'var(--selection-bg)' : 'var(--hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : restingBackground; }}
    >
      {/* 展开 chevron —— 仅目录有；已知为空的目录不显示展开箭头 */}
      <span
        onClick={entry.is_dir && !empty && !renaming ? (e) => { e.stopPropagation(); onChevronClick(entry); } : undefined}
        data-testid="file-row-expander"
        style={{
          width: iconSizes.compact, flexShrink: 0, display: 'inline-flex', justifyContent: 'center',
          color: 'var(--text-muted)',
          transition: 'transform 0.12s ease',
          transform: expanded ? 'rotate(90deg)' : 'none',
          visibility: entry.is_dir && !empty ? 'visible' : 'hidden',
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

function Crumb({ label, onClick, active, title, dropPath }: {
  label: string;
  onClick: () => void;
  active: boolean;
  title?: string;
  /** 可作为拖拽放置目标的完整路径（当前目录不可放） */
  dropPath?: string;
}) {
  return (
    <span
      title={title}
      data-drop-dir={dropPath}
      data-path={dropPath}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      style={{
        cursor: 'pointer', padding: '1px 4px', borderRadius: 3,
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        background: active ? 'var(--hover)' : 'transparent',
        fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-font-scale))',
      }}
    >{label}</span>
  );
}
