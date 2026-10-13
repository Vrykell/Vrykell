import { orderMenuItems, type MenuGroup } from '@ui/menuGroups';
import type { FsEntry } from '@platform/api/types';
import { t } from '@i18n';
import type { ContextMenuItem } from '@ui/ContextMenu';
import type { FileClipboard } from '@features/files/hooks/useFileBrowser';
import type { FileMenuItemKey } from '@features/files/model/filePanelConfig';

/**
 * fileMenu — 按状态配置（菜单 key 列表）渲染右键 / 空白 / ⋯ 菜单。
 *
 * 「显示哪些条目」由 filePanelConfigFor(target) 决定，这里只负责把 key 变成菜单项，
 * 因此本地与 SSH 面板不会各自漂移出两套顺序与文案。
 */

/** 菜单项需要的回调：面板按自己的能力提供，未提供的条目不会渲染。 */
export interface FileMenuHandlers {
  /** 收起全部展开的文件夹（文件树 ⋯ 菜单，任何时候都可用）。 */
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
  onOpenDownloads?: () => void;
  onNewTabHere?: (currentDir: string) => void;
  /** 在系统文件管理器中定位某个条目（本地专有）。 */
  onReveal?: (entry: FsEntry) => void;
  /** 在系统文件管理器中定位当前文件夹（⋯ 菜单，本地专有）。 */
  onRevealDir?: (dir: string) => void;
}

export interface FileMenuContext {
  /** 右键命中的行（空白菜单为 null） */
  entry: FsEntry | null;
  /** 菜单作用目标：命中行属于多选时是整组 */
  targets: FsEntry[];
  currentDir: string | null;
  /**
   * 命中行的落点目录：文件夹 = 自身；文件 = 它的同级目录；空白处 = 当前目录。
   * 粘贴等竖切操作按它落点，语义与拖放、新建保持一致（rule 24）。
   */
  targetDir: string | null;
  clipboard: FileClipboard | null;
  /** 该行是否在工作区（本地专有高亮） */
  inWorkspace?: boolean;
  handlers: FileMenuHandlers;
}

const cmdLabel = (base: string, count: number) => (count > 1 ? `${base} ${count} 项` : base);

/** key → 菜单项；返回 null 表示当前状态不显示该条目。 */
function itemFor(key: FileMenuItemKey, ctx: FileMenuContext): ContextMenuItem | null {
  const { entry, targets, currentDir, clipboard, handlers } = ctx;
  const single = targets[0] ?? entry;
  const count = targets.length;

  switch (key) {
    case 'new-file':
      return currentDir === null ? null : { label: '新建文件', onClick: () => handlers.onNew('file', entry) };
    case 'new-folder':
      return currentDir === null ? null : { label: '新建文件夹', onClick: () => handlers.onNew('dir', entry) };
    case 'workspace-add':
      return ctx.inWorkspace || !single ? null : { label: '添加到工作区', onClick: () => handlers.onWorkspaceToggle?.(single, false) };
    case 'workspace-remove':
      return ctx.inWorkspace && single ? { label: '从工作区移除', onClick: () => handlers.onWorkspaceToggle?.(single, true) } : null;
    case 'open-tab':
      return single ? { label: '在新标签页中打开', onClick: () => handlers.onOpenTab?.(single) } : null;
    case 'open-editor':
      return single ? { label: '使用终端编辑器打开', onClick: () => handlers.onOpenEditor?.(single) } : null;
    case 'open-system':
      return single ? { label: '使用系统默认应用打开', onClick: () => handlers.onOpenSystem?.(single) } : null;
    case 'open-with':
      return single ? { label: '打开方式…', onClick: () => handlers.onOpenWith?.(single) } : null;
    case 'copy':
      return { label: cmdLabel('复制', count), onClick: () => handlers.onCopy(targets) };
    case 'cut':
      return { label: cmdLabel('剪切', count), onClick: () => handlers.onCut(targets) };
    case 'paste':
      if (!clipboard || ctx.targetDir === null) return null;
      // 右键文件夹：粘贴进该文件夹；右键文件：粘贴到它的同级目录；空白处：当前目录
      return { label: '粘贴', onClick: () => handlers.onPasteInto(ctx.targetDir!) };
    case 'copy-path':
      return single ? { label: '复制路径', onClick: () => void navigator.clipboard.writeText(single.path) } : null;
    case 'reveal':
      if (single && handlers.onReveal) {
        return { label: t('files.reveal'), onClick: () => handlers.onReveal!(single) };
      }
      if (!single && ctx.targetDir && handlers.onRevealDir) {
        const dir = ctx.targetDir;
        return { label: t('files.reveal.dir'), onClick: () => handlers.onRevealDir!(dir) };
      }
      return null;
    case 'rename':
      return single ? { label: '重命名', onClick: () => handlers.onRename(single) } : null;
    case 'download':
      return handlers.onDownload
        ? { label: single.is_dir ? cmdLabel('下载文件夹到本地', count) : cmdLabel('下载到本地', count), onClick: () => handlers.onDownload!(targets) }
        : null;
    case 'delete':
      return { label: cmdLabel('删除', count), danger: true, onClick: () => handlers.onDelete(targets) };
    case 'upload-file':
      return handlers.onUpload ? { label: '上传文件', onClick: () => handlers.onUpload!('file') } : null;
    case 'upload-dir':
      return handlers.onUpload ? { label: '上传文件夹', onClick: () => handlers.onUpload!('dir') } : null;
    case 'new-tab-here':
      return currentDir === null ? null : { label: '从当前文件夹新建标签页', onClick: () => handlers.onNewTabHere?.(currentDir) };
    case 'sync-cwd':
      return handlers.onSyncToCwd ? { label: t('files.syncToCwd'), onClick: handlers.onSyncToCwd } : null;
    case 'sync-terminal':
      return handlers.onSyncToTerminal ? { label: t('Switch terminal to this directory'), onClick: handlers.onSyncToTerminal } : null;
    case 'downloads-view':
      return handlers.onOpenDownloads ? { label: '下载管理', onClick: () => handlers.onOpenDownloads?.() } : null;
    case 'collapse-all':
      return handlers.onCollapseAll ? { label: t('files.collapseAll'), onClick: handlers.onCollapseAll } : null;
    default:
      return null;
  }
}

/** 按 key 列表渲染菜单项（跳过当前状态不可用的条目）。 */
export function buildFileMenuItems(keys: FileMenuItemKey[], ctx: FileMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const key of keys) {
    const item = itemFor(key, ctx);
    if (item) {
      const clipboard = ['cut', 'copy', 'paste', 'copy-path'];
      const group: MenuGroup = key.startsWith('open-') || key === 'new-tab-here' ? 'primary'
        : clipboard.includes(key) ? 'clipboard'
          : ['new-file', 'new-folder', 'rename', 'upload-file', 'upload-dir', 'download'].includes(key) ? 'edit'
            : ['reveal', 'sync-terminal', 'sync-cwd', 'downloads-view', 'collapse-all'].includes(key) ? 'view' : 'organize';
      items.push({ ...item, group, order: clipboard.includes(key) ? clipboard.indexOf(key) : 0 });
    }
  }
  return orderMenuItems(items);
}
