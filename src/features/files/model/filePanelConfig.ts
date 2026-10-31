import type { FsEntry } from '@platform/api/types';
import type { FileOpsTarget } from '@features/files/model/fileOps';
import { t } from '@i18n';

/**
 * filePanelConfig — the parts of the file panel that vary by state live here.
 *
 * One state variable (FileOpsTarget: local / a given SSH connection) decides:
 *   - which entries the context menu and the ⋯ menu show, and in what order
 *   - whether dragging out needs a download first, and whether a native file drop moves or uploads
 *   - file opening semantics and the toolbar buttons
 * The UI only renders from this config instead of keeping its own checks.
 */

/** Menu entry keys (their order is the display order). */
export type FileMenuItemKey =
  | 'new-file' | 'new-folder'
  | 'workspace-add' | 'workspace-remove' | 'open-tab'
  | 'open-editor' | 'open-system' | 'open-with' | 'reveal' | 'properties'
  | 'copy' | 'cut' | 'paste' | 'copy-path' | 'rename' | 'download' | 'delete'
  | 'upload-file' | 'upload-dir' | 'new-tab-here' | 'sync-cwd' | 'sync-terminal' | 'downloads-view' | 'collapse-all'
  | 'uploads-view' | 'refresh';

export interface FilePanelConfig {
  variant: 'local' | 'ssh';
  /** Test ids (e2e depends on them; keep the existing names) */
  ids: {
    tree: string;
    crumbBar: string;
    pathInput: string;
    back: string;
    forward: string;
    more: string;
    row: (entry: FsEntry) => string;
    rowSelector: string;
    expander: string;
  };
  menus: {
    /** Context menu on a folder row */
    rowFolder: FileMenuItemKey[];
    /** Context menu on a file row */
    rowFile: FileMenuItemKey[];
    /** Context menu on one row of a multi-selection (applies to the whole group) */
    rowMulti: FileMenuItemKey[];
    /** Context menu on blank space */
    blank: FileMenuItemKey[];
    /** ⋯ menu (the panel places the undo entry first automatically) */
    more: FileMenuItemKey[];
  };
  drag: {
    /** Whether dragging out to the system requires a download first (remote = true) */
    downloadBeforeNativeDrag: boolean;
    /** Native file drop into the panel: move into the panel (local) or upload (remote) */
    externalDropMode: 'move' | 'upload';
    /** Whether the source is cleaned up after a successful native drag (local = move, true; remote = download, source kept, false) */
    cleanupSourceAfterNativeDrag: boolean;
  };
  open: 'terminal-editor' | 'remote-editor';
  /** Opening a file typed into the path bar: system default app locally, the panel editor remotely. */
  pathBarFile: 'system-app' | 'editor';
  /** Whether to provide the "switch terminal to the current directory" button */
  syncToTerminal: boolean;
  /** First breadcrumb segment (local root node / remote "/") */
  rootLabel: string;
  /** Directory the first breadcrumb segment navigates to: local null (root node), remote '/' (root directory).
      A remote null means "not resolved yet → home directory"; the root breadcrumb must never use it or it would re-resolve home. */
  rootPath: string | null;
  /** Name source shown while path is unknown (remote home not resolved yet) */
  pendingLabel?: 'connection';
}

const LOCAL_IDS: FilePanelConfig['ids'] = {
  tree: 'local-file-tree',
  crumbBar: 'crumb-bar',
  pathInput: 'path-input',
  back: 'local-back-btn',
  forward: 'local-forward-btn',
  more: 'local-more-btn',
  row: () => 'file-row',
  rowSelector: '[data-file-row]',
  expander: 'file-row-expander',
};

const SSH_IDS: FilePanelConfig['ids'] = {
  tree: 'remote-file-tree',
  crumbBar: 'remote-crumb-bar',
  pathInput: 'remote-path-input',
  back: 'remote-back-btn',
  forward: 'remote-forward-btn',
  more: 'remote-more-btn',
  row: (entry) => `remote-file-${entry.name}`,
  rowSelector: '[data-file-row]',
  expander: 'remote-row-expander',
};

/** State variable → panel config: the only point where local and SSH diverge. */
export function filePanelConfigFor(target: FileOpsTarget): FilePanelConfig {
  if (target.kind === 'ssh') {
    return {
      variant: 'ssh',
      ids: SSH_IDS,
      menus: {
        rowFolder: ['new-file', 'new-folder', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'download', 'properties', 'delete'],
        rowFile: ['new-file', 'new-folder', 'open-editor', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'download', 'properties', 'delete'],
        rowMulti: ['copy', 'cut', 'paste', 'download', 'delete'],
        // Blank space and the ⋯ menu expose the same actions (remote adds upload); only the destination is fixed to the current directory
        blank: ['paste', 'new-file', 'new-folder', 'upload-file', 'upload-dir', 'sync-terminal', 'sync-cwd', 'downloads-view', 'uploads-view', 'collapse-all', 'refresh'],
        more: ['new-file', 'new-folder', 'upload-file', 'upload-dir', 'sync-terminal', 'sync-cwd', 'downloads-view', 'uploads-view', 'collapse-all', 'refresh'],
      },
      drag: { downloadBeforeNativeDrag: true, externalDropMode: 'upload', cleanupSourceAfterNativeDrag: false },
      open: 'remote-editor',
      pathBarFile: 'editor',
      syncToTerminal: true,
      rootLabel: '/',
      rootPath: '/',
      pendingLabel: 'connection',
    };
  }
  return {
    variant: 'local',
    ids: LOCAL_IDS,
    menus: {
      rowFolder: ['new-file', 'new-folder', 'workspace-add', 'workspace-remove', 'open-tab', 'reveal', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'properties', 'delete'],
      rowFile: ['new-file', 'new-folder', 'open-editor', 'open-system', 'open-with', 'reveal', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'properties', 'delete'],
      rowMulti: ['copy', 'cut', 'paste', 'delete'],
      // Blank space and the ⋯ menu expose the same actions; only the destination is fixed to the current directory
      blank: ['paste', 'new-file', 'new-folder', 'new-tab-here', 'sync-terminal', 'sync-cwd', 'reveal', 'downloads-view', 'uploads-view', 'collapse-all', 'refresh'],
      more: ['new-file', 'new-folder', 'new-tab-here', 'sync-terminal', 'sync-cwd', 'reveal', 'downloads-view', 'uploads-view', 'collapse-all', 'refresh'],
    },
    drag: { downloadBeforeNativeDrag: false, externalDropMode: 'move', cleanupSourceAfterNativeDrag: true },
    open: 'terminal-editor',
    pathBarFile: 'editor',
    syncToTerminal: true,
    rootLabel: t('This PC'),
    rootPath: null,
  };
}
