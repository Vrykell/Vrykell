import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { iconSizes, Folder, File, MoreHorizontal, FolderArrowRight, ChevronRight, ArrowUp } from '@ui/icons';
import type { SshFsEntry } from '@features/ssh/services/api';
import type { SshConnection } from '@features/ssh/services/api';
import { IconBtn } from '@ui/UiBtn';
import ContextMenu from '@ui/ContextMenu';
import ConfirmDialog from '@ui/ConfirmDialog';
import ErrorBox from '@ui/ErrorBox';
import DownloadManager from '@features/files/components/DownloadManager';
import { compactPathSegments } from '@features/files/utils/breadcrumb';
import { flattenVisible, type VisibleRow } from '@features/files/utils/fileTree';
import { useRemoteFileBrowser } from '@features/ssh/hooks/useRemoteFileBrowser';
import { describeFileServiceFailure } from '@features/ssh/model/fileServiceState';
import { useExternalFileDrop } from '@features/files/hooks/useExternalFileDrop';
import { useFileRowDrag } from '@features/files/hooks/useFileRowDrag';
import { useFileDragStore } from '@features/files';
import { useDockStore } from '@features/workspace';
import { termInstances } from '@features/terminal';
import { sshPaneIdFor, parentOfRemote, normalizeRemotePath } from '@features/ssh/utils/remotePath';

/** 与本地一致：单击选中，双击进入 / 编辑，可多选、可拖拽、可回退。 */
export default function RemoteFiles({ conn, enabled = true }: { conn: SshConnection; enabled?: boolean }) {
  const {
    refresh,
    path,
    navigate,
    goBack,
    canGoBack,
    entries,
    error,
    loading,
    selection,
    anchorPath,
    selectOnly,
    toggleSelection,
    replaceSelection,
    expandedSet,
    childCache,
    childLoading,
    childErrors,
    toggleExpand,
    retryExpand,
    scrollRef,
    clipboard,
    cutPaths,
    undo,
    undoCount,
    runUndo,
    copySelection,
    cutSelection,
    pasteClipboard,
    ctxMenu,
    renameTarget,
    confirm,
    showDownloads,
    moreMenu,
    setShowDownloads,
    closeContextMenu,
    closeMoreMenu,
    openMoreMenu,
    remoteEdit,
    handleContextMenu,
    buildMenuItems,
    requestRename,
    cancelRename,
    cancelConfirm,
    confirmAction,
    syncToTerminal,
    doUpload,
    doUploadDir,
    uploadPaths,
    moveInto,
    downloadForDrag,
  } = useRemoteFileBrowser(conn, enabled);
  const failure = error ? describeFileServiceFailure(error) : null;

  // 顶栏面包屑压缩：不换行，侧栏窄时省略高层级目录（必须在视图切换的提前返回之前）
  const segs = path ? path.split('/').filter(Boolean) : [];
  const crumbRef = useRef<HTMLDivElement>(null);
  const [crumbWidth, setCrumbWidth] = useState(0);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
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
    () => compactPathSegments(segs, (s) => '/' + s.join('/'), maxChars),
    [segs, maxChars],
  );

  // 面板内拖动：移动到目标远程目录；拖出窗口先下载（记入下载历史）再交给系统拖拽
  const startRowDrag = useFileRowDrag({
    onDrop: (items, target) => { void moveInto(items, target.dir); },
    prepareNativeDrag: async (items) => {
      const locals = await downloadForDrag(items);
      return locals ? { paths: locals, mode: 'copy' } : null;
    },
    onNativeDragEnd: refresh,
  });
  const dragTarget = useFileDragStore((state) => state.target);

  // 系统文件拖入：命中远程文件夹行/文件行（同级目录），落在空白处 = 当前远程目录 → 上传
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
    onDrop: (paths, target) => { void uploadPaths(paths, target.dir); },
  });

  // hooks 之后再做视图切换，避免「条件 hook」导致 React 报错
  if (showDownloads) return <DownloadManager onBack={() => setShowDownloads(false)} />;

  const rows = flattenVisible(entries, expandedSet, childCache);

  /** 面包屑 → 可编辑路径：进入即全选，回车跳转，Esc / 失焦取消。 */
  const beginPathEdit = () => setPathDraft(path ?? '');
  const cancelPathEdit = () => setPathDraft(null);
  const commitPathEdit = () => {
    const next = (pathDraft ?? '').trim();
    cancelPathEdit();
    if (!next || next === path) return;
    navigate(normalizeRemotePath(next));
  };

  /** 空白处右键：粘贴 / 上传；没有可执行项时不弹菜单 */
  const handleTreeContextMenu = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('[data-testid^="remote-file-"]')) return;
    if (!clipboard && path === null) return;
    event.preventDefault();
    setBlankMenu({ x: event.clientX, y: event.clientY });
  };

  /** 进入目录 / 编辑文件 —— 双击与 Enter 共用 */
  const activateEntry = (entry: SshFsEntry) => {
    if (entry.is_dir) navigate(entry.path);
    else remoteEdit(entry);
  };

  /** 单击选中；Shift 连选、Ctrl/Cmd 加选；双击进入/编辑 */
  const handleRowClick = (entry: SshFsEntry, event: React.MouseEvent) => {
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

  const targetsForEntry = (entry: SshFsEntry): SshFsEntry[] => {
    if (!selection.has(entry.path)) return [entry];
    return rows.filter((row) => selection.has(row.entry.path)).map((row) => row.entry);
  };

  /** ↑/↓ 移动选中并滚入视野，Enter 进入/编辑；剪贴板走 Ctrl/Cmd+C/X/V */
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
      const targets = targetsForEntry(anchorEntry);
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
      const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-testid^="remote-file-"]') ?? [])
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
      {/* 顶栏：面包屑（可编辑）+ 操作按钮（右对齐，更多在最右） */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '6px 8px',
        fontSize: 'calc(11px * var(--ui-font-scale))', minHeight: 30, flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        <div
          ref={crumbRef}
          data-testid="remote-crumb-bar"
          onClick={pathDraft === null ? beginPathEdit : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 2,
            flex: 1, minWidth: 0, overflow: 'hidden',
            cursor: pathDraft === null ? 'text' : undefined,
          }}
        >
          {pathDraft === null ? (
            <>
              {path === null ? <span title={conn.name} style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>远程文件 · {conn.name}</span>
                : <Crumb label="/" onClick={() => navigate('/')} active={path === '/'} dropPath={path === '/' ? undefined : '/'} />}
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
                      title={isCurrent ? '单击编辑路径，回车跳转' : undefined}
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
              data-testid="remote-path-input"
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
            data-testid="remote-sync-btn"
            onClick={() => void syncToTerminal()}
          >
            <FolderArrowRight size={iconSizes.control} />
          </IconBtn>
          {/* 回退 = 上一个文件树视图快照（展开/选中/滚动），不是固定上级目录 */}
          <IconBtn
            title="回到上一个视图"
            data-testid="remote-back-btn"
            disabled={!canGoBack}
            onClick={goBack}
          >
            <ArrowUp size={iconSizes.control} />
          </IconBtn>
          <IconBtn
            title="更多操作"
            data-testid="remote-more-btn"
            onClick={openMoreMenu}
          >
            <MoreHorizontal size={iconSizes.control} />
          </IconBtn>
        </div>
      </div>

      {/* 远程文件树 */}
      <div
        className="scroll-region"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={handleTreeContextMenu}
        data-testid="remote-file-tree"
        data-path={path ?? ''}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
      >
        {loading ? (
          <div role="status" style={{ padding: 20, color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>正在连接文件服务…</div>
        ) : failure ? (
          <ErrorBox
            tone={failure.kind === 'error' ? 'error' : 'info'}
            title={failure.title}
            details={error ?? undefined}
            style={{ margin: 16, overflowWrap: 'anywhere' }}
            actions={<>
              <button style={{ minHeight: 36 }} onClick={() => {
                const dock = useDockStore.getState();
                const side = dock.leftPanels.includes('files') ? 'left' : 'right';
                dock.togglePanel(side, 'files');
                const paneId = sshPaneIdFor(conn.id);
                if (paneId) termInstances.get(paneId)?.focus();
              }}>继续使用终端</button>
              <button style={{ minHeight: 36 }} onClick={refresh}>重试文件服务</button>
            </>}
          >
            {failure.message}
          </ErrorBox>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>空目录</div>
        ) : rows.map((row) => (
          <Fragment key={row.entry.path}>
            <RemoteRow
              row={row}
              selected={selection.has(row.entry.path)}
              cut={cutPaths.has(row.entry.path)}
              dropTarget={externalDrop?.rowPath === row.entry.path || dragTarget?.rowPath === row.entry.path}
              renaming={renameTarget?.path === row.entry.path}
              onRenameCommit={requestRename}
              onRenameCancel={cancelRename}
              onRowClick={handleRowClick}
              onRowPointerDown={(event) => startRowDrag(event, [{ path: row.entry.path, name: row.entry.name, is_dir: row.entry.is_dir }])}
              onRowDoubleClick={activateEntry}
              onRowContextMenu={handleContextMenu}
              onChevronClick={toggleExpand}
            />
            {row.expanded && childLoading.has(row.entry.path) && (
              <div role="status" style={{ padding: '4px 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>正在读取目录…</div>
            )}
            {row.expanded && childErrors[row.entry.path] && (
              <ErrorBox
                compact
                style={{ margin: '4px 12px' }}
                actions={<button onClick={() => retryExpand(row.entry)} style={{ minHeight: 32 }}>重试</button>}
              >
                {childErrors[row.entry.path]}
              </ErrorBox>
            )}
          </Fragment>
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={buildMenuItems(ctxMenu.entry)}
          onClose={closeContextMenu}
        />
      )}

      {blankMenu && (
        <ContextMenu
          anchor={blankMenu}
          items={[
            ...(clipboard
              ? [{ label: clipboard.mode === 'cut' ? '粘贴（移动）' : '粘贴', onClick: () => void pasteClipboard() }]
              : []),
            { label: '上传文件', onClick: () => void doUpload() },
            { label: '上传文件夹', onClick: () => void doUploadDir() },
          ]}
          onClose={() => setBlankMenu(null)}
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
            { label: '上传文件', onClick: () => void doUpload() },
            { label: '上传文件夹', onClick: () => void doUploadDir() },
            { label: '下载管理', onClick: () => setShowDownloads(true) },
          ]}
          onClose={closeMoreMenu}
        />
      )}

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

function RemoteRow({
  row,
  selected,
  cut,
  dropTarget,
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
  /** 拖拽悬停在本行：高亮提示移动/上传目标 */
  dropTarget: boolean;
  renaming: boolean;
  onRenameCommit: (entry: SshFsEntry, newName: string) => void;
  onRenameCancel: (entry: SshFsEntry) => void;
  onRowClick: (entry: SshFsEntry, event: React.MouseEvent) => void;
  onRowPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onRowDoubleClick: (entry: SshFsEntry) => void;
  onRowContextMenu: (e: React.MouseEvent, entry: SshFsEntry) => void;
  onChevronClick: (entry: SshFsEntry) => void;
}) {
  const { entry, depth, expanded, empty } = row;
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
      onPointerDown={renaming ? undefined : onRowPointerDown}
      onDoubleClick={renaming ? undefined : () => onRowDoubleClick(entry)}
      onContextMenu={renaming ? undefined : (event) => onRowContextMenu(event, entry)}
      title={renaming
        ? '输入新名称，回车确认，Esc 取消'
        : entry.is_dir
          ? '单击选中，双击进入，可拖入文件'
          : '单击选中，双击在终端里编辑'}
      data-testid={`remote-file-${entry.name}`}
      data-path={entry.path}
      data-selected={selected ? 'true' : undefined}
      data-drop-dir={renaming ? undefined : (entry.is_dir ? entry.path : (parentOfRemote(entry.path) ?? '/'))}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: `5px 10px 5px ${4 + depth * 14}px`,
        fontSize: 'var(--fs-label)', lineHeight: '20px', minHeight: 32,
        cursor: renaming ? 'text' : 'pointer',
        background: dropTarget ? 'var(--accent-bg)' : restingBackground,
        opacity: cut ? 0.55 : 1,
        outline: dropTarget ? '1px solid var(--accent)' : undefined,
        outlineOffset: -1,
        color: entry.is_dir ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
      onMouseEnter={(event) => { event.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : selected ? 'var(--selection-bg)' : 'var(--hover)'; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : restingBackground; }}
    >
      {/* 展开 chevron —— 仅目录有；已知为空的目录不显示展开箭头 */}
      <span
        onClick={entry.is_dir && !empty && !renaming ? (event) => { event.stopPropagation(); onChevronClick(entry); } : undefined}
        data-testid="remote-row-expander"
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
      <span style={{ width: 18, flexShrink: 0, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
        {entry.is_dir ? <Folder size={13} /> : <File size={13} />}
      </span>
      {renaming ? (
        <input
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
            background: 'var(--canvas)', border: '1px solid var(--accent)',
            borderRadius: 3, padding: '0 4px', fontSize: 'calc(12px * var(--ui-font-scale))',
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
