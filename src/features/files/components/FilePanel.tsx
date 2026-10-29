import { useFileUndoSettings } from '@config/fileUndo';
import { useFileDirectoryShortcuts } from '../hooks/useFileDirectoryShortcuts';
import { TextInput } from '@ui/fields/TextInput';
import InlineRenameInput from '@ui/fields/InlineRenameInput';
import { compactSidebarRowContent } from '@ui/layout/sidebarRow';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Search, MoreHorizontal, iconSizes } from '@ui/icons';
import { IconBtn } from '@ui/actions/UiBtn';
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
import ContextMenu from '@ui/menus/ContextMenu';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useToastStore } from '@ui/feedback/Toast';
import { downloadsDiscard } from '@features/files/services/downloads';
import { t } from '@i18n';

export interface FilePanelProps {
  /** Execution target: the local and SSH file panels are two values of this state. */
  target: FileOpsTarget;
  enabled?: boolean;
  /** Reload after external authentication without discarding navigation or undo history. */
  reloadRevision?: number;
  initialPath?: string | null;
  /** Set when `initialPath` is a remembered location: `null` then means the drive view. */
  initialResolved?: boolean;
  onPathChange?: (path: string | null) => void;
  /** Open a file on double-click or Enter. */
  openEntry: (entry: FsEntry) => void;
  /** Switch the terminal to the validated directory from the overflow menu. */
  onSyncToTerminal?: (currentDir: string) => void;
  /** Current terminal directory, used to relocate the file panel. */
  terminalCwd?: string | null;
  /** Panel-specific menu callbacks; entries without one are hidden. */
  handlers?: Partial<FileMenuHandlers>;
  /** Row icon (local: by extension or workspace highlight). */
  renderIcon?: (entry: FsEntry) => ReactNode;
  /** Row highlight predicate (local workspace folders). */
  isHighlighted?: (path: string) => boolean;
  /** Label shown while a path is unresolved (remote connection name). */
  pendingLabel?: string;
  /** Custom error view (remote: file service failure). */
  renderError?: (error: string, retry: () => void) => ReactNode;
  /** View for a null path (local: disk cards). */
  renderNullPathView?: (api: { disks: DiskEntry[]; settled: boolean; navigate: (path: string | null) => void }) => ReactNode;
  /** External file drops: the remote panel uploads; local drops default to moving. */
  onExternalDrop?: (paths: string[], target: { rowPath: string | null; dir: string }) => void;
  /** Prepare a native drag (remote: download locally before handing it to the system). */
  prepareNativeDrag?: (items: Array<{ path: string; name: string; is_dir: boolean }>) => Promise<{ paths: string[]; mode: 'copy' | 'move' } | null>;
}

/**
 * Shared view for the local and SSH file panels.
 *
 * Browsing, selection, back/forward, clipboard, undo history and file operations come from
 * useFileBrowser. Differences such as visible menu entries, download-before-drag and move versus
 * upload are derived by filePanelConfigFor(target); the view only renders that configuration.
 */
export default function FilePanel({
  target,
  enabled = true,
  reloadRevision = 0,
  initialPath = null,
  initialResolved = false,
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
  const undoEnabled = useFileUndoSettings(state => target.kind === 'ssh' ? state.remote : state.local);
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
    navigate,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
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
  } = useFileBrowser({ target, enabled, initialPath, initialResolved, onPathChange, openEntry });

  const seenReloadRevision = useRef(reloadRevision);
  useEffect(() => {
    if (seenReloadRevision.current === reloadRevision) return;
    seenReloadRevision.current = reloadRevision;
    if (enabled) refresh();
  }, [reloadRevision, enabled, refresh]);

  const rows = useMemo(() => flattenVisible(entries, expandedSet, childCache), [entries, expandedSet, childCache]);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [propertiesTarget, setPropertiesTarget] = useState<FsEntry | null>(null);
  const pathBarRequest = useRef(0);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const directoryReady = path !== null && settled && !error && !loading && !navigationPending;
  const [externalDrop, setExternalDrop] = useState<{ rowPath: string | null; dir: string } | null>(null);

  // Compact breadcrumbs into one line, hiding higher levels when the sidebar is narrow.
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

  /** Remote drag cancelled: delete the temporary copies downloaded for it; the remote sources are unchanged. */
  const discardNativeDragCopies = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      await downloadsDiscard(paths);
      useToastStore.getState().addToast(t('files.dragOut.cancelled'), 'info');
    } catch (error) {
      useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error');
    }
  };

  /** Drop into a directory moves; dragging out may download first, then cleans up the source. */
  const startRowDrag = useFileRowDrag({
    onDrop: (items, dropTarget) => {
      const paths = items.map((item) => item.path);
      if (paths.some((p) => dropTarget.dir === p || dropTarget.dir.startsWith(`${p}/`))) return;
      void transferInto(paths, dropTarget.dir, 'move');
    },
    prepareNativeDrag: config.drag.downloadBeforeNativeDrag ? prepareNativeDrag : undefined,
    onNativeDragEnd: (result, items, payload) => {
      // Local: the system accepts a move, so a completed drag removes the source. Remote: a drag
      // downloads a copy, so the source must stay.
      if (result === 'Dropped' && config.drag.cleanupSourceAfterNativeDrag) {
        void removeAfterTransfer(items.map((item) => ({ name: item.name, path: item.path, is_dir: item.is_dir })));
      } else if (result === 'Cancelled' && config.drag.downloadBeforeNativeDrag) {
        void discardNativeDragCopies(payload.paths);
      }
      refresh();
    },
  });
  const dragTarget = useFileDragStore((state) => state.target);
  const dragItems = useFileDragStore((state) => state.items);

  /** External drop target: the hit row's directory, or the current directory for blank space. */
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

  /** Whether a row renders as a drop target: internal drags need a valid target; external ones only the hit row. */
  const isDropTarget = (row: VisibleRow) => {
    if (dragTarget?.rowPath === row.entry.path) {
      const dir = dragTarget.dir;
      const invalid = dir === path || dragItems.some((item) => dir === item.path || dir.startsWith(`${item.path}/`));
      if (!invalid) return true;
    }
    return externalDrop?.rowPath === row.entry.path;
  };

  /** Breadcrumb to editable path: select all, Enter navigates, Esc or blur cancels. */
  const beginPathEdit = () => setPathDraft(path ?? '');
  const cancelPathEdit = () => setPathDraft(null);

  /** Menu callbacks: the panel implements core actions; the host injects panel-specific ones. */
  const handlers: FileMenuHandlers = {
    onCollapseAll: collapseAll,
    onNew: (kind, entry) => void createEntry(kind, entry),
    onCopy: copySelection,
    onCut: cutSelection,
    onPasteInto: (dir) => void pasteInto(dir),
    onRename: (entry) => startRename(entry),
    onDelete: (targets) => confirmDelete(targets),
    onProperties: (entry) => setPropertiesTarget(entry),
    // Both panel-level menus (⋯ and blank area) re-read the current directory from the backend.
    onRefresh: refresh,
    ...extraHandlers,
    onSyncToCwd: terminalCwd != null ? () => { void navigate(terminalCwd); }
      : onSyncToTerminal ? () => useToastStore.getState().addToast(t('The terminal has not reported its working directory yet.'), 'info') : undefined,
    onSyncToTerminal: config.syncToTerminal && onSyncToTerminal && directoryReady
      ? () => { if (path !== null) onSyncToTerminal(path); } : undefined,
  };
  useFileDirectoryShortcuts(enabled, handlers.onSyncToTerminal, handlers.onSyncToCwd);

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

  /** Menu targets: the whole multi-selection when the hit row belongs to it. */
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

  /** Enter a directory or open a file; shared by double-click and Enter. */
  const activateEntry = (entry: FsEntry) => {
    if (entry.is_dir) navigate(entry.path);
    else openEntry(entry);
  };

  /** Click selects; Shift extends, Ctrl/Cmd toggles; double-click enters or opens. */
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

  /** Arrows move the cursor into view and Enter activates; clipboard uses Ctrl/Cmd+C/X/V. */
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

  /** Blank-area context menu: only when no row was hit; the disk view has no actions. */
  const handleTreeContextMenu = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('[data-file-row]')) return;
    if (path === null) return;
    openBlankMenu(event);
  };

  const openHint = t('Click to select; double-click to open with your preferred editor.');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      userSelect: 'none', background: 'transparent',
    }}>
      {/* Top bar: editable breadcrumbs plus actions, with the overflow menu at the far right. */}
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
                  title={path === null ? t('Click to edit the path; press Enter to navigate') : undefined}
                />
              )}
              {hiddenCount > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>›</span>
                  <span data-tip={t('Parent folders are hidden')} style={{ color: 'var(--text-muted)', letterSpacing: 1 }}>…</span>
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
                      title={isCurrent ? t('Click to edit the path; press Enter to navigate') : undefined}
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
              aria-label={t('Edit path')}
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
          {/* Back / forward walk the visit trail: every directory keeps its expansion, selection and scroll,
              and a jumped-out branch is reached through forward instead of replayed by back. */}
          <IconBtn title={t('Return to the previous view')} data-testid={config.ids.back} disabled={!canGoBack} onClick={goBack}>
            <ArrowUp size={iconSizes.control} />
          </IconBtn>
          <IconBtn title={t('Return to the next view')} data-testid={config.ids.forward} disabled={!canGoForward} onClick={goForward}>
            <ArrowDown size={iconSizes.control} />
          </IconBtn>
          {/* The recovery view owns the panel while browsing is impossible: no overflow menu. */}
          {!error && <IconBtn title={t('More actions')} data-testid={config.ids.more} onClick={openMoreMenu}>
            <MoreHorizontal size={iconSizes.control} />
          </IconBtn>}
        </div>
      </div>

      {/* File tree */}
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
        {error && <>
          {renderError
            ? renderError(error, refresh)
            : <ErrorBox style={{ margin: 12 }} actions={<button onClick={refresh} style={{ minHeight: 32 }}>{t('Retry')}</button>}>{error}</ErrorBox>}
          {!settled && path !== null && <button style={{ margin: 12 }} onClick={() => { void navigate(null); }}>{t('Return to home directory')}</button>}
        </>}
        {loadingHint ? (
          <div role="status" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>
            {config.variant === 'ssh' ? t('files.loading.ssh') : path === null ? t('files.loading.disks') : t('files.loading.directory')}
          </div>
        ) : error && !settled ? null : path === null && renderNullPathView ? (
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
                  <ErrorBox title={t('Unable to read directory')} details={childErrors[row.entry.path]}
                    actions={<button type="button" onClick={() => void refreshDir(row.entry)}>{t('Retry')}</button>} />
                )}
              </Fragment>
            ))}
            {rows.length === 0 && settled && (
              <div style={{ padding: 16, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)', textAlign: 'center' }}>
                {t('Empty directory')}
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
            // Undo appears only after a file operation; the history stack can unwind repeatedly.
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
        title={confirm?.kind === 'delete' ? t('Confirm deletion') : t('Confirm rename')}
        message={
          confirm
            ? confirm.kind === 'delete'
              ? !undoEnabled ? t('Delete selected items without application undo? Remote deletion is permanent; local deletion uses the system trash.') : confirm.entries.length > 1
                ? t('Delete the {{count}} selected items? You can restore them from More → Undo delete.', { count: confirm.entries.length })
                : t('Delete "{{name}}"? You can restore it from More → Undo delete.', { name: confirm.entries[0]!.name })
              : t('Rename "{{name}}" to "{{newName}}"?', { name: confirm.entry.name, newName: confirm.newName })
            : undefined
        }
        danger={confirm?.kind === 'delete'}
        confirmLabel={confirm?.kind === 'delete' ? t('Delete') : t('Rename')}
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

// File row

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
  /** Cut and awaiting paste; dimmed to show it will move. */
  cut: boolean;
  /** A drag hovers this row, so it highlights as the drop target. */
  dropTarget: boolean;
  /** Accent color for workspace folders and similar rows. */
  highlighted: boolean;
  renaming: boolean;
  icon?: ReactNode;
  openHint: string;
  /** Drop directory: a folder is its own; a file drops into its parent (which is what dropping on the file means). */
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
        ? t('Enter a new name, press Enter to confirm, or Esc to cancel')
        : entry.is_dir
          ? (highlighted ? t('Workspace folder · click to select, double-click to open, drop files inside') : t('Click to select, double-click to open, drop files inside'))
          : openHint}
      data-testid={testId}
      data-file-row="true"
      data-path={entry.path}
      data-selected={selected ? 'true' : undefined}
      data-drop-dir={renaming ? undefined : dropDir}
      style={{
        ...compactSidebarRowContent,
        display: 'flex', alignItems: 'center', gap: 4,
        padding: `2px 10px 2px ${4 + depth * 14}px`, margin: '0 6px', borderRadius: 'var(--radius-inner)',
        fontSize: 'var(--fs-label)', lineHeight: '20px',
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
      {/* Expand chevron, folders only; empty folders keep it too (expanding shows no empty hint).
          Stop click and double-click propagation so repeated clicks toggle without entering. */}
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
        <InlineRenameInput
          autoFocus
          aria-label={t('File name')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') commit();
            else if (event.key === 'Escape') cancel();
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          data-testid="rename-input"
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

// Breadcrumb segment

function Crumb({ label, onClick, active, title, dropPath }: {
  label: string;
  onClick: () => void;
  active: boolean;
  title?: string;
  /** Full path usable as a drop target; the current directory cannot receive drops. */
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
