import { orderMenuItems, type MenuGroup } from '@ui/menus/menuGroups';
import { FILE_DIRECTORY_SHORTCUTS } from '@config/fileShortcuts';
import type { FsEntry } from '@platform/api/types';
import { t } from '@i18n';
import type { ContextMenuItem } from '@ui/menus/ContextMenu';
import { terminalBindingMenuItem, type TerminalBindingMenu } from '@ui/menus/terminalBindingMenu';
import type { FileClipboard } from '@features/files/hooks/useFileBrowser';
import type { FileMenuItemKey } from '@features/files/model/filePanelConfig';

/**
 * Builds the context, blank-area and overflow menus from the configured key list.
 *
 * filePanelConfigFor(target) decides which entries appear; this module only turns keys into menu
 * items, so local and SSH panels cannot drift into two orders or two sets of labels.
 */

/** Callbacks the menu needs; entries whose callback is absent are not rendered. */
export interface FileMenuHandlers {
  /** Collapse every expanded folder (file-tree overflow menu; always available). */
  onCollapseAll?: () => void;
  onNew: (kind: 'file' | 'dir', target: FsEntry | null) => void;
  onCopy: (targets: FsEntry[]) => void;
  onCut: (targets: FsEntry[]) => void;
  onPasteInto: (dir: string) => void;
  onRename: (entry: FsEntry) => void;
  onDelete: (targets: FsEntry[]) => void;
  onDownload?: (targets: FsEntry[]) => void;
  onUpload?: (kind: 'file' | 'dir') => void;
  onOpenEditor?: (entry: FsEntry) => void;
  onOpenSystem?: (entry: FsEntry) => void;
  onOpenWith?: (entry: FsEntry) => void;
  onOpenTab?: (entry: FsEntry) => void;
  onWorkspaceToggle?: (entry: FsEntry, inWorkspace: boolean) => void;
  /** Relocate the panel to the terminal's reported directory. */
  onSyncToCwd?: () => void;
  onSyncToTerminal?: () => void;
  onOpenUploads?: () => void;
  onOpenDownloads?: () => void;
  onNewTabHere?: (currentDir: string) => void;
  /** Reveal an entry in the system file manager (local only). */
  onReveal?: (entry: FsEntry) => void;
  /** Reveal the current folder in the system file manager (overflow menu; local only). */
  onRevealDir?: (dir: string) => void;
  /** Show the properties dialog for a single entry. */
  onProperties?: (entry: FsEntry) => void;
  /** Re-read the current directory from the backend (overflow and blank-area menus). */
  onRefresh?: () => void;
}

export interface FileMenuContext {
  /** Row hit by the context menu, or null for the blank area. */
  entry: FsEntry | null;
  /** Menu targets: the whole selection when the hit row belongs to a multi-selection. */
  targets: FsEntry[];
  currentDir: string | null;
  /**
   * Drop directory of the hit row: the folder itself, the file's parent, or the current directory
   * for a blank area. Paste and other vertical operations use it, matching drag and new-item rules.
   */
  targetDir: string | null;
  clipboard: FileClipboard | null;
  /** Whether the row is in the workspace (local highlight only). */
  inWorkspace?: boolean;
  /** Terminal binding submenu when the host provides it. */
  terminalMenu?: TerminalBindingMenu;
  handlers: FileMenuHandlers;
}

const cmdLabel = (base: string, count: number) => (count > 1 ? t('{{action}} {{count}} items', { action: base, count }) : base);

/** Key to menu item; null means the entry is hidden in the current state. */
function itemFor(key: FileMenuItemKey, ctx: FileMenuContext): ContextMenuItem | null {
  const { entry, targets, currentDir, clipboard, handlers } = ctx;
  const single = targets[0] ?? entry;
  const count = targets.length;

  switch (key) {
    case 'new-file':
      return currentDir === null ? null : { label: t('New file'), onClick: () => handlers.onNew('file', entry) };
    case 'new-folder':
      return currentDir === null ? null : { label: t('New folder'), onClick: () => handlers.onNew('dir', entry) };
    case 'workspace-add':
      return ctx.inWorkspace || !single ? null : { label: t('Add to workspace'), onClick: () => handlers.onWorkspaceToggle?.(single, false) };
    case 'workspace-remove':
      return ctx.inWorkspace && single ? { label: t('Remove from workspace'), onClick: () => handlers.onWorkspaceToggle?.(single, true) } : null;
    case 'open-tab':
      return single ? { label: t('Open in new tab'), onClick: () => handlers.onOpenTab?.(single) } : null;
    case 'open-editor':
      return single && handlers.onOpenEditor
        ? { label: t('Open with preferred editor'), onClick: () => handlers.onOpenEditor!(single) }
        : null;
    case 'open-system':
      return single ? { label: t('Open with the system default application'), onClick: () => handlers.onOpenSystem?.(single) } : null;
    case 'open-with':
      return single ? { label: t('Open with…'), onClick: () => handlers.onOpenWith?.(single) } : null;
    case 'copy':
      return { label: cmdLabel(t('Copy'), count), onClick: () => handlers.onCopy(targets) };
    case 'cut':
      return { label: cmdLabel(t('Cut'), count), onClick: () => handlers.onCut(targets) };
    case 'paste':
      if (!clipboard || ctx.targetDir === null) return null;
      // Right-clicked folder: paste inside; file: paste into its parent; blank area: current directory.
      return { label: t('Paste'), onClick: () => handlers.onPasteInto(ctx.targetDir!) };
    case 'copy-path':
      return single ? { label: t('Copy path'), onClick: () => void navigator.clipboard.writeText(single.path) } : null;
    case 'reveal':
      if (single && handlers.onReveal) {
        return { label: t('files.reveal'), onClick: () => handlers.onReveal!(single) };
      }
      if (!single && ctx.targetDir && handlers.onRevealDir) {
        const dir = ctx.targetDir;
        return { label: t('files.reveal.dir'), onClick: () => handlers.onRevealDir!(dir) };
      }
      return null;
    case 'properties':
      // Single entry only: a multi-selection has no single set of properties to show.
      return single && count === 1 && handlers.onProperties
        ? { label: t('Properties'), onClick: () => handlers.onProperties!(single) }
        : null;
    case 'rename':
      return single ? { label: t('Rename'), onClick: () => handlers.onRename(single) } : null;
    case 'download':
      return handlers.onDownload
        ? { label: single.is_dir ? cmdLabel(t('Download folder to local'), count) : cmdLabel(t('Download to local'), count), onClick: () => handlers.onDownload!(targets) }
        : null;
    case 'delete':
      return { label: cmdLabel(t('Delete'), count), danger: true, onClick: () => handlers.onDelete(targets) };
    case 'upload-file':
      return handlers.onUpload ? { label: t('Upload file'), onClick: () => handlers.onUpload!('file') } : null;
    case 'upload-dir':
      return handlers.onUpload ? { label: t('Upload folder'), onClick: () => handlers.onUpload!('dir') } : null;
    case 'new-tab-here':
      return currentDir === null ? null : { label: t('New tab from this folder'), onClick: () => handlers.onNewTabHere?.(currentDir) };
    case 'bind-terminal':
      return ctx.terminalMenu ? terminalBindingMenuItem(ctx.terminalMenu) : null;
    case 'sync-cwd':
      return handlers.onSyncToCwd ? { label: t('files.syncToCwd'), shortcut: FILE_DIRECTORY_SHORTCUTS.panel, onClick: handlers.onSyncToCwd } : null;
    case 'sync-terminal':
      return handlers.onSyncToTerminal ? { label: t('Switch terminal to this directory'), shortcut: FILE_DIRECTORY_SHORTCUTS.terminal, onClick: handlers.onSyncToTerminal } : null;
    case 'uploads-view':
      return handlers.onOpenUploads ? { label: t('Upload manager'), onClick: handlers.onOpenUploads } : null;
    case 'downloads-view':
      return handlers.onOpenDownloads ? { label: t('Download manager'), onClick: handlers.onOpenDownloads } : null;
    case 'collapse-all':
      return handlers.onCollapseAll ? { label: t('files.collapseAll'), onClick: handlers.onCollapseAll } : null;
    case 'refresh':
      return handlers.onRefresh ? { label: t('Refresh'), onClick: handlers.onRefresh } : null;
    default:
      return null;
  }
}

/** Render the menu items for a key list, skipping entries unavailable in the current state. */
export function buildFileMenuItems(keys: FileMenuItemKey[], ctx: FileMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const key of keys) {
    const item = itemFor(key, ctx);
    if (item) {
      const clipboard = ['cut', 'copy', 'paste', 'copy-path'];
      const group: MenuGroup = key.startsWith('open-') || key === 'new-tab-here' ? 'primary'
        : clipboard.includes(key) ? 'clipboard'
          : ['new-file', 'new-folder', 'rename', 'upload-file', 'upload-dir', 'download'].includes(key) ? 'edit'
            : ['reveal', 'sync-terminal', 'sync-cwd', 'bind-terminal', 'downloads-view', 'uploads-view', 'collapse-all', 'refresh'].includes(key) ? 'view' : 'organize';
      items.push({ ...item, group, order: clipboard.includes(key) ? clipboard.indexOf(key) : 0 });
    }
  }
  return orderMenuItems(items);
}
