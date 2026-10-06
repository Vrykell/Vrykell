import type { FsEntry } from '@platform/api/types';
import type { FileOpsTarget } from '@features/files/model/fileOps';

/**
 * filePanelConfig — 文件面板「因状态而异」的部分集中在这里。
 *
 * 同一个状态变量（FileOpsTarget：本地 / 某个 SSH 连接）决定：
 *   - 右键菜单与 ⋯ 菜单显示哪些条目、什么顺序
 *   - 拖出是否需要先下载、系统文件拖入是移动还是上传
 *   - 打开文件的语义与顶栏按钮
 * 界面只按这份配置渲染，不再各自维护一套判断。
 */

/** 菜单条目 key（顺序即展示顺序）。 */
export type FileMenuItemKey =
  | 'new-file' | 'new-folder'
  | 'workspace-add' | 'workspace-remove' | 'open-tab'
  | 'open-editor' | 'open-system' | 'open-with' | 'reveal'
  | 'copy' | 'cut' | 'paste' | 'copy-path' | 'rename' | 'download' | 'delete'
  | 'upload-file' | 'upload-dir' | 'new-tab-here' | 'downloads-view' | 'collapse-all';

export interface FilePanelConfig {
  variant: 'local' | 'ssh';
  /** 测试标识（e2e 依赖，保持既有命名） */
  ids: {
    tree: string;
    crumbBar: string;
    pathInput: string;
    back: string;
    more: string;
    sync: string;
    row: (entry: FsEntry) => string;
    rowSelector: string;
    expander: string;
  };
  menus: {
    /** 右键文件夹行 */
    rowFolder: FileMenuItemKey[];
    /** 右键文件行 */
    rowFile: FileMenuItemKey[];
    /** 右键多选中的一行（作用于整组） */
    rowMulti: FileMenuItemKey[];
    /** 空白处右键 */
    blank: FileMenuItemKey[];
    /** ⋯ 菜单（回退项由面板自动置于最前） */
    more: FileMenuItemKey[];
  };
  drag: {
    /** 拖出到系统前是否需要先下载到本地（远端 = true） */
    downloadBeforeNativeDrag: boolean;
    /** 系统文件拖入面板：移动进面板（本地）还是上传（远端） */
    externalDropMode: 'move' | 'upload';
    /** 拖出到系统成功后是否清理源头（本地 = 移动，true；远端 = 下载，源文件保留，false） */
    cleanupSourceAfterNativeDrag: boolean;
  };
  /** 打开文件的语义 */
  open: 'terminal-editor' | 'remote-editor';
  /** 是否提供「终端切到当前目录」按钮 */
  syncToTerminal: boolean;
  /** 面包屑首段（本地「此电脑」/ 远程「/」） */
  rootLabel: string;
  /** 点击面包屑首段去的目录：本地 null（此电脑），远程 '/'（根目录）。
      远程的 null 表示「尚未解析 → 回主目录」，根面包屑绝不能用它，否则会重新解析主目录。 */
  rootPath: string | null;
  /** path 未知（远端主目录尚未解析）时显示的名称来源 */
  pendingLabel?: 'connection';
}

const LOCAL_IDS: FilePanelConfig['ids'] = {
  tree: 'local-file-tree',
  crumbBar: 'crumb-bar',
  pathInput: 'path-input',
  back: 'local-back-btn',
  more: 'local-more-btn',
  sync: 'local-sync-btn',
  row: () => 'file-row',
  rowSelector: '[data-file-row]',
  expander: 'file-row-expander',
};

const SSH_IDS: FilePanelConfig['ids'] = {
  tree: 'remote-file-tree',
  crumbBar: 'remote-crumb-bar',
  pathInput: 'remote-path-input',
  back: 'remote-back-btn',
  more: 'remote-more-btn',
  sync: 'remote-sync-btn',
  row: (entry) => `remote-file-${entry.name}`,
  rowSelector: '[data-file-row]',
  expander: 'remote-row-expander',
};

/** 状态变量 → 面板配置：本地与 SSH 的唯一分歧点。 */
export function filePanelConfigFor(target: FileOpsTarget): FilePanelConfig {
  if (target.kind === 'ssh') {
    return {
      variant: 'ssh',
      ids: SSH_IDS,
      menus: {
        rowFolder: ['new-file', 'new-folder', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'download', 'delete'],
        rowFile: ['new-file', 'new-folder', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'download', 'delete'],
        rowMulti: ['copy', 'cut', 'paste', 'download', 'delete'],
        blank: ['new-file', 'new-folder', 'paste', 'upload-file', 'upload-dir'],
        more: ['new-file', 'new-folder', 'upload-file', 'upload-dir', 'downloads-view', 'collapse-all'],
      },
      drag: { downloadBeforeNativeDrag: true, externalDropMode: 'upload', cleanupSourceAfterNativeDrag: false },
      open: 'remote-editor',
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
      rowFolder: ['new-file', 'new-folder', 'workspace-add', 'workspace-remove', 'open-tab', 'reveal', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'delete'],
      rowFile: ['new-file', 'new-folder', 'open-editor', 'open-system', 'open-with', 'reveal', 'copy', 'cut', 'paste', 'copy-path', 'rename', 'delete'],
      rowMulti: ['copy', 'cut', 'paste', 'delete'],
      blank: ['new-file', 'new-folder', 'paste', 'new-tab-here'],
      more: ['new-file', 'new-folder', 'new-tab-here', 'reveal', 'downloads-view', 'collapse-all'],
    },
    drag: { downloadBeforeNativeDrag: false, externalDropMode: 'move', cleanupSourceAfterNativeDrag: true },
    open: 'terminal-editor',
    syncToTerminal: true,
    rootLabel: '此电脑',
    rootPath: null,
  };
}
