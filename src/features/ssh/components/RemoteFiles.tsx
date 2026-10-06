import { useEffect, useState, useRef, useMemo } from 'react';
import { iconSizes, Folder, File, MoreHorizontal, FolderArrowRight, ArrowUp } from '@ui/icons';
import type { SshFsEntry } from '@features/ssh/services/api';
import type { SshConnection } from '@features/ssh/services/api';
import { IconBtn } from '@ui/UiBtn';
import ContextMenu from '@ui/ContextMenu';
import ConfirmDialog from '@ui/ConfirmDialog';
import DownloadManager from '@features/files/components/DownloadManager';
import { compactPathSegments } from '@features/files/utils/breadcrumb';
import { useRemoteFileBrowser } from '@features/ssh/hooks/useRemoteFileBrowser';
import { describeFileServiceFailure } from '@features/ssh/model/fileServiceState';
import { useExternalFileDrop } from '@features/files/hooks/useExternalFileDrop';
import { useFileRowDrag } from '@features/files/hooks/useFileRowDrag';
import { useFileDragStore } from '@features/files';
import { useDockStore } from '@features/workspace';
import { termInstances } from '@features/terminal';
import { sshPaneIdFor, parentOfRemote } from '@features/ssh/utils/remotePath';

/**
 * RemoteFiles — SSH 标签页的文件面板。
 * 目录单击进入；文件**双击远程编辑**（在 SSH 终端里用编辑器打开，不下载到本地）。
 * 右键：重命名 / 下载到本地（含目录）/ 删除；顶栏「上传」多选上传文件、
 * 「上传文件夹」递归上传目录、「下载」进入下载管理页。
 */
export default function RemoteFiles({ conn, enabled = true }: { conn: SshConnection; enabled?: boolean }) {
  const {
    refresh,
    path,
    setPath,
    entries,
    error,
    loading,
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
    goUp,
    syncToTerminal,
    doUpload,
    doUploadDir,
    uploadPaths,
    moveInto,
    downloadForDrag,
  } = useRemoteFileBrowser(conn, enabled);
  const failure = error ? describeFileServiceFailure(error) : null;

  // 面板内拖动（移动）；拖出窗口先下载到本地（记入下载历史）再交给系统拖拽
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
  const listRef = useRef<HTMLDivElement>(null);
  const [externalDrop, setExternalDrop] = useState<{ rowPath: string | null; dir: string } | null>(null);
  useExternalFileDrop({
    resolveTarget: (x, y) => {
      const list = listRef.current;
      if (!list) return null;
      const rect = list.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
      const zone = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-dir]');
      const dir = zone && list.contains(zone) ? zone.dataset.dropDir ?? null : null;
      if (dir) return { rowPath: zone!.dataset.path ?? null, dir };
      return path === null ? null : { rowPath: null, dir: path };
    },
    onHover: setExternalDrop,
    onDrop: (paths, target) => { void uploadPaths(paths, target.dir); },
  });

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

  // 面包屑：真实路径层级（/ › home › user › …），根是顶层、home 是 /home/user

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
          {path === null ? <span title={conn.name} style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>远程文件 · {conn.name}</span>
            : <Crumb label="/" onClick={() => setPath('/')} active={path === '/'} />}
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
        {!loading && !error && <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
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
            <FolderArrowRight size={iconSizes.control} />
          </IconBtn>
          <IconBtn
            title="更多操作"
            data-testid="remote-more-btn"
            onClick={openMoreMenu}
          >
            <MoreHorizontal size={iconSizes.control} />
          </IconBtn>
        </div>}
      </div>

      {/* 远程文件列表 */}
      <div className="scroll-region" ref={listRef} data-testid="remote-file-list" style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div role="status" style={{ padding: 20, color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>正在连接文件服务…</div>
        ) : failure ? (
          <div role={failure.kind === 'error' ? 'alert' : 'status'} style={{ padding: 16, fontSize: 'var(--fs-label)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{failure.title}</strong>
            <p>{failure.message}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button style={{ minHeight: 36 }} onClick={() => {
                const dock = useDockStore.getState();
                const side = dock.leftPanels.includes('files') ? 'left' : 'right';
                dock.togglePanel(side, 'files');
                const paneId = sshPaneIdFor(conn.id);
                if (paneId) termInstances.get(paneId)?.focus();
              }}>继续使用终端</button>
              <button style={{ minHeight: 36 }} onClick={refresh}>重试文件服务</button>
            </div>
            <details style={{ marginTop: 12, overflowWrap: 'anywhere', color: 'var(--text-muted)' }}><summary style={{ cursor: 'pointer' }}>技术详情</summary>{error}</details>
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>空目录</div>
        ) : entries.map((e) => (
          <RemoteRow
            key={e.path}
            entry={e}
            renaming={renameTarget?.path === e.path}
            dropTarget={externalDrop?.rowPath === e.path || dragTarget?.rowPath === e.path}
            onPointerDown={(event) => startRowDrag(event, [{ path: e.path, name: e.name, is_dir: e.is_dir }])}
            onRenameCommit={requestRename}
            onRenameCancel={cancelRename}
            onClick={(entry) => entry.is_dir && setPath(entry.path)}
            onDoubleClick={(entry) => !entry.is_dir && remoteEdit(entry)}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

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
            { label: '上传文件', onClick: doUpload },
            { label: '上传文件夹', onClick: doUploadDir },
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
              ? `确定要删除「${confirm.entry.name}」吗？远程删除不可恢复。`
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
  entry,
  renaming,
  dropTarget,
  onPointerDown,
  onRenameCommit,
  onRenameCancel,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  entry: SshFsEntry;
  renaming: boolean;
  /** 拖拽悬停在本行：高亮提示移动/上传目标 */
  dropTarget: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
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
      onPointerDown={renaming ? undefined : onPointerDown}
      onDoubleClick={renaming ? undefined : () => onDoubleClick(entry)}
      onContextMenu={renaming ? undefined : (ev) => onContextMenu(ev, entry)}
      title={renaming
        ? '输入新名称，回车确认，Esc 取消'
        : entry.is_dir ? `进入 ${entry.path}` : `双击在终端里编辑 ${entry.path}`}
      data-testid={`remote-file-${entry.name}`}
      data-path={entry.path}
      data-drop-dir={renaming ? undefined : (entry.is_dir ? entry.path : (parentOfRemote(entry.path) ?? '/'))}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', fontSize: 'var(--fs-label)', lineHeight: '20px', minHeight: 32,
        cursor: renaming ? 'text' : 'pointer',
        background: dropTarget ? 'var(--accent-bg)' : 'transparent',
        outline: dropTarget ? '1px solid var(--accent)' : undefined,
        outlineOffset: -1,
        color: entry.is_dir ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
      onMouseEnter={(ev) => { ev.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : 'var(--hover)'; }}
      onMouseLeave={(ev) => { ev.currentTarget.style.background = dropTarget ? 'var(--accent-bg)' : 'transparent'; }}
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
