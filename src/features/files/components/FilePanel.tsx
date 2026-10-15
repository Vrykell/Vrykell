import { TextInput } from '@ui/TextInput';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUp, ChevronRight, Search, MoreHorizontal, iconSizes } from '@ui/icons';
import { IconBtn } from '@ui/UiBtn';
import type { DiskEntry, FsEntry, FileStat } from '@platform/api/types';
import { flattenVisible, type VisibleRow } from '@features/files/utils/fileTree';
import { fileIcon } from '@features/files/utils/fileIcon';
import { compactPathSegments } from '@features/files/utils/breadcrumb';
import { buildFileMenuItems, type FileMenuHandlers } from '@features/files/utils/fileMenu';
import { filePanelConfigFor } from '@features/files/model/filePanelConfig';
import { resolveTargetDir, type FileOpsTarget } from '@features/files/model/fileOps';
import { useFileBrowser } from '@features/files/hooks/useFileBrowser';
import { useFileRowDrag } from '@features/files/hooks/useFileRowDrag';
import { useExternalFileDrop } from '@features/files/hooks/useExternalFileDrop';
import { useFileDragStore } from '@features/files';
import FileDragPreview from '@features/files/components/FileDragPreview';
import FilePropertiesDialog from '@features/files/components/FilePropertiesDialog';
import FileSearchMenu from './FileSearchMenu';
import ContextMenu from '@ui/ContextMenu';
import ConfirmDialog from '@ui/ConfirmDialog';
import ErrorBox from '@ui/ErrorBox';
import { useToastStore } from '@ui/Toast';
import { downloadsDiscard } from '@features/files/services/downloads';
import { t } from '@i18n';

export interface FilePanelProps {
  /** 执行目标：本地文件面板与 SSH 文件面板只是这个状态变量的不同取值。 */
  target: FileOpsTarget;
  enabled?: boolean;
  /** Reload after external authentication without discarding navigation or undo history. */
  reloadRevision?: number;
  initialPath?: string | null;
  onPathChange?: (path: string | null) => void;
  /** 双击 / Enter 打开文件 */
  openEntry: (entry: FsEntry) => void;
  /** Switch the terminal to the validated directory from the overflow menu. */
  onSyncToTerminal?: (currentDir: string) => void;
  /** Current terminal directory, used to relocate the file panel. */
  terminalCwd?: string | null;
  /** 面板专有菜单回调：未提供的条目不会出现在菜单里 */
  handlers?: Partial<FileMenuHandlers>;
  /** 行图标（本地按扩展名 / 工作区高亮） */
  renderIcon?: (entry: FsEntry) => ReactNode;
  /** 行高亮判定（本地工作区文件夹） */
  isHighlighted?: (path: string) => boolean;
  /** path 未解析时显示的名称（远程连接名） */
  pendingLabel?: string;
  /** 自定义错误视图（远程：文件服务失败说明） */
  renderError?: (error: string, retry: () => void) => ReactNode;
  /** path 为 null 时的视图（本地：磁盘卡片） */
  renderNullPathView?: (api: { disks: DiskEntry[]; settled: boolean; navigate: (path: string | null) => void }) => ReactNode;
  /** 系统文件拖入：远端由上层上传，本地默认按移动处理 */
  onExternalDrop?: (paths: string[], target: { rowPath: string | null; dir: string }) => void;
  /** 拖出窗口前的准备（远端：先下载到本地再交给系统拖拽） */
  prepareNativeDrag?: (items: Array<{ path: string; name: string; is_dir: boolean }>) => Promise<{ paths: string[]; mode: 'copy' | 'move' } | null>;
}

/**
 * FilePanel — 本地与 SSH 文件面板共用的视图。
 *
 * 浏览、选中、视图回退、剪贴板、回退历史与文件操作全部来自 useFileBrowser；
 * 「菜单显示什么、拖出是否先下载、拖入是移动还是上传」等状态差异全部由
 * filePanelConfigFor(target) 推导，界面只按配置渲染。
 */
export default function FilePanel({
  target,
  enabled = true,
  reloadRevision = 0,
  initialPath = null,
  onPathChange,
  openEntry,
  onSyncToTerminal,
  terminalCwd,
  handlers: extraHandlers,
  renderIcon,
  isHighlighted,
  pendingLabel,
  renderError,
  renderNullPathView,
  onExternalDrop,
  prepareNativeDrag,
}: FilePanelProps) {
  const config = useMemo(() => filePanelConfigFor(target), [target]);
  const {
    ops,
    path,
    entries,
    disks,
    settled,
    loading,
    navigationPending,
    loadingHint,
    error,
    refresh,
    load,
    navigate,
    goBack,
    canGoBack,
    selection,
    anchorPath,
    selectOnly,
    revealPath,
    toggleSelection,
    replaceSelection,
    expandedSet,
    childCache,
    childErrors,
    childLoadingHint,
    toggleExpand,
    refreshDir,
    scrollRef,
    clipboard,
    cutPaths,
    undo,
    undoCount,
    runUndo,
    copySelection,
    cutSelection,
    pasteClipboard,
    pasteInto,
    transferInto,
    createEntry,
    removeAfterTransfer,
    collapseAll,
    ctxMenu,
    handleContextMenu,
    closeContextMenu,
    blankMenu,
    openBlankMenu,
    closeBlankMenu,
    moreMenu,
    openMoreMenu,
    closeMoreMenu,
    renameTarget,
    startRename,
    requestRename,
    cancelRename,
    confirm,
    confirmDelete,
    cancelConfirm,
    confirmAction,
  } = useFileBrowser({ target, enabled, initialPath, onPathChange, openEntry });

  const seenReloadRevision = useRef(reloadRevision);
  useEffect(() => {
    if (seenReloadRevision.current === reloadRevision) return;
    seenReloadRevision.current = reloadRevision;
    if (enabled) refresh();
  }, [reloadRevision, enabled, refresh]);

  const rows = flattenVisible(entries, expandedSet, childCache);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [propertiesTarget, setPropertiesTarget] = useState<FsEntry | null>(null);
  const pathBarRequest = useRef(0);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const directoryReady = path !== null && settled && !error && !loading && !navigationPending;
  const [externalDrop, setExternalDrop] = useState<{ rowPath: string | null; dir: string } | null>(null);

  // 面包屑压缩：不换行，侧栏窄时省略高层级目录
  const segs = path === null ? [] : ops.segments(path);
  const crumbRef = useRef<HTMLDivElement>(null);
  const [crumbWidth, setCrumbWidth] = useState(0);
  useEffect(() => {
    const el = crumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCrumbWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxChars = Math.max(4, Math.floor(crumbWidth / 6.6) - 10);
  const { visible: visibleCrumbs, hiddenCount } = useMemo(
    () => compactPathSegments(segs, (list) => ops.joinSegments(list), maxChars),
    [segs, maxChars, ops],
  );

  /** 远端拖出取消：删除本次拖拽下载的临时副本并提示（源文件在远端，未被改动）。 */
  const discardNativeDragCopies = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      await downloadsDiscard(paths);
      useToastStore.getState().addToast(t('files.dragOut.cancelled'), 'info');
    } catch (error) {
      useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error');
    }
  };

  /** 拖到目标目录 = 移动；拖出窗口按配置决定是否先下载，成功后按移动语义清理源 */
  const startRowDrag = useFileRowDrag({
    onDrop: (items, dropTarget) => {
      const paths = items.map((item) => item.path);
      if (paths.some((p) => dropTarget.dir === p || dropTarget.dir.startsWith(`${p}/`))) return;
      void transferInto(paths, dropTarget.dir, 'move');
    },
    prepareNativeDrag: config.drag.downloadBeforeNativeDrag ? prepareNativeDrag : undefined,
    onNativeDragEnd: (result, items, payload) => {
      // 本地：系统按「移动」接收，拖出成功后清理源头；远端：拖出=下载，源文件必须保留
      if (result === 'Dropped' && config.drag.cleanupSourceAfterNativeDrag) {
        void removeAfterTransfer(items.map((item) => ({ name: item.name, path: item.path, is_dir: item.is_dir })));
      } else if (result === 'Cancelled' && config.drag.downloadBeforeNativeDrag) {
        void discardNativeDragCopies(payload.paths);
      }
      load(path);
    },
  });
  const dragTarget = useFileDragStore((state) => state.target);
  const dragItems = useFileDragStore((state) => state.items);

  /** 系统文件拖入：命中行 = 该行的落点目录，空白处 = 当前目录 */
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
    onDrop: (paths, dropTarget) => {
      if (config.drag.externalDropMode === 'upload') onExternalDrop?.(paths, dropTarget);
      else void transferInto(paths, dropTarget.dir, 'move');
    },
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

  /** 面包屑 → 可编辑路径：进入即全选，回车跳转，Esc / 失焦取消 */
  const beginPathEdit = () => setPathDraft(path ?? '');
  const cancelPathEdit = () => setPathDraft(null);

  /** 菜单回调：核心动作由面板实现，专有动作由上层注入 */
  const handlers: FileMenuHandlers = {
    onCollapseAll: collapseAll,
    onNew: (kind, entry) => void createEntry(kind, entry),
    onCopy: copySelection,
    onCut: cutSelection,
    onPasteInto: (dir) => void pasteInto(dir),
    onRename: (entry) => startRename(entry),
    onDelete: (targets) => confirmDelete(targets),
    onProperties: (entry) => setPropertiesTarget(entry),
    ...extraHandlers,
    onSyncToCwd: terminalCwd != null ? () => { void navigate(terminalCwd); }
      : onSyncToTerminal ? () => useToastStore.getState().addToast(t('The terminal has not reported its working directory yet.'), 'info') : undefined,
    onSyncToTerminal: config.syncToTerminal && onSyncToTerminal && directoryReady
      ? () => { if (path !== null) onSyncToTerminal(path); } : undefined,
  };

  /**
   * Path bar commit: directories navigate as usual, while a file path opens
   * instead of failing with a read-directory error. The panel configuration
   * picks the opening route (local: system default app, remote: editor).
   */
  const commitPathEdit = () => {
    // Tolerate quoted pastes (the "Copy as path" style).
    const next = (pathDraft ?? '').trim().replace(/^"(.*)"$/, '$1');
    cancelPathEdit();
    if (!next || next === path) return;
    void openTypedPath(ops.joinSegments(ops.segments(next)));
  };

  const openTypedPath = async (destination: string) => {
    const request = ++pathBarRequest.current;
    let info: FileStat | null = null;
    try {
      info = await ops.stat(destination);
    } catch {
      // Missing or unreadable: fall through to navigation, which reports the usual error.
    }
    // A newer commit replaced this one while the metadata was loading.
    if (request !== pathBarRequest.current) return;
    if (info && !info.is_dir) {
      const entry: FsEntry = { name: info.name, path: info.path, is_dir: false, is_symlink: info.is_symlink };
      if (config.pathBarFile === 'system-app' && handlers.onOpenSystem) handlers.onOpenSystem(entry);
      else openEntry(entry);
      return;
    }
    void navigate(destination);
  };

  /** 菜单作用目标：命中行属于多选时是整组 */
  const targetsFor = (entry: FsEntry): FsEntry[] => {
    if (!selection.has(entry.path)) return [entry];
    const byPath = new Map<string, FsEntry>();
    for (const row of rows) {
      if (selection.has(row.entry.path)) byPath.set(row.entry.path, row.entry);
    }
    return byPath.size > 0 ? [...byPath.values()] : [entry];
  };

  const menuKeysFor = (entry: FsEntry): typeof config.menus.rowFile =>
    targetsFor(entry).length > 1
      ? config.menus.rowMulti
      : entry.is_dir ? config.menus.rowFolder : config.menus.rowFile;

  /** 进入目录 / 打开文件 —— 双击与 Enter 共用 */
  const activateEntry = (entry: FsEntry) => {
    if (entry.is_dir) navigate(entry.path);
    else openEntry(entry);
  };

  /** 单击选中；Shift 连选、Ctrl/Cmd 加选；双击进入目录 / 打开文件 */
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

  /** ↑/↓ 移动光标并滚入视野，Enter 进入 / 打开；剪贴板走 Ctrl/Cmd+C/X/V */
  const handleTreeKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;

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
      const element = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>(config.ids.rowSelector) ?? [])
        .find((candidate) => candidate.dataset.path === nextPath);
      element?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (event.key === 'Enter') {
      const selected = rows.find((row) => row.entry.path === anchorPath);
      if (!selected) return;
      event.preventDefault();
      activateEntry(selected.entry);
    }
  };

  /** 空白处右键：命中的不是行才弹（磁盘视图没有可执行项时不弹） */
  const handleTreeContextMenu = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('[data-file-row]')) return;
    if (path === null) return;
    openBlankMenu(event);
  };

  const openHint = config.open === 'remote-editor'
    ? '单击选中，双击在终端里编辑'
    : '单击选中，双击在终端编辑器中打开';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      userSelect: 'none', background: 'transparent',
    }}>
      {/* 顶栏：面包屑（可编辑）+ 操作按钮（更多在最右） */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '6px 8px',
        fontSize: 'calc(11px * var(--ui-font-scale))', minHeight: 30, flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        <div
          ref={crumbRef}
          data-testid={config.ids.crumbBar}
          onClick={pathDraft === null ? beginPathEdit : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 2,
            flex: 1, minWidth: 0, overflow: 'hidden',
            cursor: pathDraft === null ? 'text' : undefined,
          }}
        >
          {pathDraft === null ? (
            <>
              {path === null && config.pendingLabel === 'connection' && pendingLabel ? (
                <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pendingLabel}</span>
              ) : (
                <Crumb
                  label={config.rootLabel}
                  onClick={() => navigate(config.rootPath)}
                  active={path === null}
                  title={path === null ? '单击编辑路径，回车跳转' : undefined}
                />
              )}
              {hiddenCount > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>›</span>
                  <span data-tip="已省略上级目录" style={{ color: 'var(--text-muted)', letterSpacing: 1 }}>…</span>
                </>
              )}
              {visibleCrumbs.map((crumb, index) => {
                const isCurrent = index === visibleCrumbs.length - 1;
                return (
                  <span key={crumb.full} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <span style={{ color: 'var(--text-muted)' }}>›</span>
                    <Crumb
                      label={crumb.seg}
                      onClick={isCurrent ? beginPathEdit : () => navigate(crumb.full)}
                      active={isCurrent}
                      title={isCurrent ? '单击编辑路径，回车跳转' : undefined}
                      dropPath={isCurrent ? undefined : crumb.full}
                    />
                  </span>
                );
              })}
            </>
          ) : (
            <TextInput
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
              data-testid={config.ids.pathInput}
              style={{
                flex: 1, minWidth: 0, height: 22, padding: '0 6px',
                background: 'var(--field-bg)', border: '1px solid var(--border)',
                borderRadius: 4, outline: 'none',
                fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-font-scale))',
                color: 'var(--text-primary)',
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <IconBtn title={t('Search files')} data-testid={`${config.variant}-file-search-btn`}
            disabled={!directoryReady} onClick={(event) => {
              searchReturnFocus.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
              setSearchOpen(true);
            }}>
            <Search size={iconSizes.control} />
          </IconBtn>
          {/* 回退 = 上一个文件树视图快照（展开 / 选中 / 滚动），不是固定上级目录 */}
          <IconBtn title="回到上一个视图" data-testid={config.ids.back} disabled={!canGoBack} onClick={goBack}>
            <ArrowUp size={iconSizes.control} />
          </IconBtn>
          {/* The recovery view owns the panel while browsing is impossible: no overflow menu. */}
          {!error && <IconBtn title="更多操作" data-testid={config.ids.more} onClick={openMoreMenu}>
            <MoreHorizontal size={iconSizes.control} />
          </IconBtn>}
        </div>
      </div>

      {/* 文件树 */}
      <div
        className="scroll-region"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={handleTreeContextMenu}
        data-testid={config.ids.tree}
        data-path={path ?? ''}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
      >
        {loadingHint ? (
          <div role="status" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>
            {config.variant === 'ssh' ? t('files.loading.ssh') : path === null ? t('files.loading.disks') : t('files.loading.directory')}
          </div>
        ) : error ? <>
          {renderError
            ? renderError(error, refresh)
            : <ErrorBox style={{ margin: 12 }} actions={<button onClick={refresh} style={{ minHeight: 32 }}>重试</button>}>{error}</ErrorBox>}
          {path !== null && <button style={{ margin: 12 }} onClick={() => { void navigate(null); }}>{t('Return to home directory')}</button>}
        </> : path === null && renderNullPathView ? (
          renderNullPathView({ disks, settled, navigate })
        ) : (
          <>
            {rows.map((row) => (
              <Fragment key={row.entry.path}>
                <FileRow
                  row={row}
                  testId={config.ids.row(row.entry)}
                  expanderTestId={config.ids.expander}
                  selected={selection.has(row.entry.path)}
                  cut={cutPaths.has(row.entry.path)}
                  dropTarget={isDropTarget(row)}
                  highlighted={isHighlighted?.(row.entry.path) ?? false}
                  renaming={renameTarget?.path === row.entry.path}
                  icon={renderIcon?.(row.entry)}
                  openHint={openHint}
                  dropDir={row.entry.is_dir ? row.entry.path : ops.parentOf(row.entry.path) ?? undefined}
                  onRenameCommit={requestRename}
                  onRenameCancel={cancelRename}
                  onRowClick={handleRowClick}
                  onRowPointerDown={(event) => {
                    const picked = selection.has(row.entry.path)
                      ? rows.filter((item) => selection.has(item.entry.path)).map((item) => item.entry)
                      : [row.entry];
                    startRowDrag(event, picked.map((item) => ({ path: item.path, name: item.name, is_dir: item.is_dir })));
                  }}
                  onRowDoubleClick={activateEntry}
                  onRowContextMenu={handleContextMenu}
                  onChevronClick={toggleExpand}
                />
                {row.expanded && childLoadingHint.has(row.entry.path) && (
                  <div role="status" style={{ padding: `5px 10px 5px ${4 + (row.depth + 1) * 14}px`, color: 'var(--text-muted)' }}>{t('files.loading.directory')}</div>
                )}
                {row.expanded && childErrors[row.entry.path] && (
                  // 与文件树行同缩进、同行高的普通行（不是告警卡片），右侧给一个重试按钮
                  <div
                    role="alert"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: `5px 10px 5px ${4 + (row.depth + 1) * 14}px`,
                      color: 'var(--danger)',
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {childErrors[row.entry.path]}
                    </span>
                    <button onClick={() => void refreshDir(row.entry)} style={{ minHeight: 24, padding: '0 8px' }}>重试</button>
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

      {searchOpen && path !== null && enabled && <FileSearchMenu key={path} ops={ops} root={path}
        returnFocus={searchReturnFocus.current}
        onClose={() => setSearchOpen(false)} onChoose={(entry) => {
          setSearchOpen(false);
          void navigate(entry.is_dir ? entry.path : ops.parentOf(entry.path)).then((success) => {
            if (success && !entry.is_dir) { selectOnly(entry.path); revealPath(entry.path); }
          });
        }} />}

      {ctxMenu && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={buildFileMenuItems(menuKeysFor(ctxMenu.entry), {
            entry: ctxMenu.entry,
            targets: targetsFor(ctxMenu.entry),
            currentDir: path,
            targetDir: resolveTargetDir(ctxMenu.entry, path ?? '', ops.parentOf),
            clipboard,
            inWorkspace: isHighlighted?.(ctxMenu.entry.path) ?? false,
            handlers,
          })}
          onClose={closeContextMenu}
        />
      )}

      {moreMenu && (
        <ContextMenu
          anchor={moreMenu}
          items={[
            // 回退入口只在确实操作过文件后出现；历史栈可连续回退
            ...(undo ? [{
              label: undoCount > 1
                ? t('files.undo.menuSteps', { label: t(undo.labelKey), n: undoCount })
                : t('files.undo.menu', { label: t(undo.labelKey) }),
              onClick: () => void runUndo(),
            }] : []),
            ...buildFileMenuItems(config.menus.more, {
              entry: null,
              targets: [],
              currentDir: path,
              targetDir: path,
              clipboard,
              handlers,
            }),
          ]}
          onClose={closeMoreMenu}
        />
      )}

      {blankMenu && (
        <ContextMenu
          anchor={blankMenu}
          items={buildFileMenuItems(config.menus.blank, {
            entry: null,
            targets: [],
            currentDir: path,
            targetDir: path,
            clipboard,
            handlers,
          })}
          onClose={closeBlankMenu}
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

      {propertiesTarget && (
        <FilePropertiesDialog
          entry={propertiesTarget}
          location={ops.parentOf(propertiesTarget.path) ?? config.rootLabel}
          stat={ops.stat}
          onClose={() => setPropertiesTarget(null)}
        />
      )}
    </div>
  );
}

// ── 文件行 ──

function FileRow({
  row,
  testId,
  expanderTestId,
  selected,
  cut,
  dropTarget,
  highlighted,
  renaming,
  icon,
  openHint,
  dropDir,
  onRenameCommit,
  onRenameCancel,
  onRowClick,
  onRowPointerDown,
  onRowDoubleClick,
  onRowContextMenu,
  onChevronClick,
}: {
  row: VisibleRow;
  testId: string;
  expanderTestId: string;
  selected: boolean;
  /** 已剪切待粘贴：淡显提示会被移走 */
  cut: boolean;
  /** 拖拽悬停在本行：高亮放置目标 */
  dropTarget: boolean;
  /** 工作区文件夹等强调色 */
  highlighted: boolean;
  renaming: boolean;
  icon?: ReactNode;
  openHint: string;
  /** 拖放落点目录：文件夹 = 自身，文件 = 同级目录（拖到文件上等于拖到它所在目录） */
  dropDir?: string;
  onRenameCommit: (entry: FsEntry, newName: string) => void;
  onRenameCancel: (entry: FsEntry) => void;
  onRowClick: (entry: FsEntry, event: React.MouseEvent) => void;
  onRowPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onRowContextMenu: (event: React.MouseEvent, entry: FsEntry) => void;
  onChevronClick: (entry: FsEntry) => void;
}) {
  const { entry, depth, expanded } = row;
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
  /** Default row icon follows the entry kind (dirs vs file type) unless the panel overrides it. */
  const RowIcon = fileIcon(entry.name, entry.is_dir);

  return (
    <div
      onClick={renaming ? undefined : (event) => onRowClick(entry, event)}
      onPointerDown={renaming ? undefined : onRowPointerDown}
      onDoubleClick={renaming ? undefined : () => onRowDoubleClick(entry)}
      onContextMenu={renaming ? undefined : (event) => onRowContextMenu(event, entry)}
      data-tip={renaming
        ? '输入新名称，回车确认，Esc 取消'
        : entry.is_dir
          ? (highlighted ? '工作区文件夹 · 单击选中，双击进入，可拖入文件' : '单击选中，双击进入，可拖入文件')
          : openHint}
      data-testid={testId}
      data-file-row="true"
      data-path={entry.path}
      data-selected={selected ? 'true' : undefined}
      data-drop-dir={renaming ? undefined : dropDir}
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
          ? (highlighted ? 'var(--accent-warm)' : 'var(--text-primary)')
          : 'var(--text-secondary)',
      }}
      onMouseEnter={(event) => { event.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : selected ? 'var(--selection-bg)' : 'var(--hover)'; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : restingBackground; }}
    >
      {/* 展开 chevron —— 仅目录有；空目录同样保留箭头（展开后不显示任何空提示）。
          阻断 click 与 dblclick 冒泡：连点箭头只切换展开，不会被行当成双击而进入目录。 */}
      <span
        onClick={entry.is_dir && !renaming ? (event) => { event.stopPropagation(); onChevronClick(entry); } : undefined}
        onDoubleClick={(event) => event.stopPropagation()}
        data-testid={expanderTestId}
        data-row-expander="true"
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
        {icon ?? <RowIcon size={iconSizes.row} fill={entry.is_dir && highlighted ? 'currentColor' : 'none'} />}
      </span>
      {renaming ? (
        <TextInput
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            else if (event.key === 'Escape') cancel();
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          data-testid="rename-input"
          style={{
            flex: 1, minWidth: 0,
            background: 'var(--field-bg)', border: '1px solid var(--border)',
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
      data-tip={title}
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
