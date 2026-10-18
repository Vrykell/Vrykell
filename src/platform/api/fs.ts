import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { invoke } from '@platform/diagnostics';
import { normPath } from '@platform/path';
import type { FsEntry, DiskEntry, FileStat } from '@platform/api/types';

export type { FsEntry, DiskEntry, FileStat };

/**
 * 打开系统原生选择器（文件 / 多文件 / 目录 / 保存）并**在 Rust 侧登记**用户选中的路径。
 *
 * 为什么不让网页自己调 dialog 插件：读文件内容的命令（附件导入等）只接受"用户动作产生的
 * 路径"，而只有 Rust 亲自打开选择器才知道那次选择真的来自用户——网页拿到的是路径，不是
 * 随便指名路径的权力。返回值是后端规范化后的绝对路径。
 */
export function pickPath(
  mode: 'file' | 'files' | 'directory' | 'save' = 'file',
  options?: { extensions?: string[]; fileName?: string },
): Promise<string[]> {
  return invoke<string[]>('pick_path', {
    request: {
      mode,
      extensions: options?.extensions ?? null,
      fileName: options?.fileName ?? null,
    },
  });
}

/**
 * 本地文件系统 API —— 所有跨 IPC 边界的路径都在这里归一化：
 * 入参路径先规范成前端统一的 `/` 形式再 invoke，后端返回的路径（条目、磁盘、主目录）
 * 也先规范化再交给业务层。业务层直接使用规范路径，不再自行处理分隔符与盘符根。
 */

/** 列出目录条目（path 为空时由后端决定起始目录）。 */
export function fsList(path?: string | null): Promise<FsEntry[]> {
  return invoke<FsEntry[]>('fs_list', { path: path == null ? null : normPath(path) })
    .then((entries) => entries.map((entry) => ({ ...entry, path: normPath(entry.path) })));
}

/** 列出磁盘（macOS 根卷+挂载卷 / Windows 盘符），附带容量信息。 */
export function fsDisks(): Promise<DiskEntry[]> {
  return invoke<DiskEntry[]>('fs_disks')
    .then((disks) => disks.map((disk) => ({ ...disk, path: normPath(disk.path) })));
}

/** 用户主目录路径。 */
export function fsHome(): Promise<string> {
  return invoke<string>('fs_home').then((home) => normPath(home));
}

/** Read metadata for one local path (path bar file detection and the properties dialog). */
export function fsStat(path: string): Promise<FileStat> {
  return invoke<FileStat>('fs_stat', { path: normPath(path) })
    .then((stat) => ({ ...stat, path: normPath(stat.path) }));
}

/** 重命名：目标名被占用时后端自动加序号，返回最终路径。 */
export function fsRename(oldPath: string, newName: string): Promise<string> {
  return invoke<string>('fs_rename', { oldPath: normPath(oldPath), newName }).then(normPath);
}

/** 新建空文件（同名自动加序号），返回最终路径。 */
export function fsCreateFile(dir: string, name: string): Promise<string> {
  return invoke<string>('fs_create_file', { dir: normPath(dir), name }).then(normPath);
}

/** 新建文件夹（同名自动加序号），返回最终路径。 */
export function fsCreateDir(dir: string, name: string): Promise<string> {
  return invoke<string>('fs_create_dir', { dir: normPath(dir), name }).then(normPath);
}

/** 完成的一条 from→to 对（用于记录文件操作回退）。 */
export interface FileOpPair {
  from: string;
  to: string;
}

/** 批量文件操作结果：完成项 + 失败说明（部分失败不中断其余项）。 */
export interface FileOpOutcome {
  completed: FileOpPair[];
  errors: string[];
}

function normalizePair(pair: FileOpPair): FileOpPair {
  return { from: normPath(pair.from), to: normPath(pair.to) };
}

function normalizeOutcome(outcome: FileOpOutcome): FileOpOutcome {
  return { completed: outcome.completed.map(normalizePair), errors: outcome.errors };
}

/** 复制到目标目录（目录递归，符号链接按链接复制）。 */
export function fsCopy(paths: string[], destDir: string): Promise<FileOpOutcome> {
  return invoke<FileOpOutcome>('fs_copy', { paths: paths.map(normPath), destDir: normPath(destDir) })
    .then(normalizeOutcome);
}

/** 移动到目标目录（跨盘自动退化为复制 + 删源）。 */
export function fsMove(paths: string[], destDir: string): Promise<FileOpOutcome> {
  return invoke<FileOpOutcome>('fs_move', { paths: paths.map(normPath), destDir: normPath(destDir) })
    .then(normalizeOutcome);
}

/** 可回退删除：先把内容移动到应用暂存区，返回 原始→暂存 映射。 */
export function fsStageDelete(paths: string[], undoEnabled = true): Promise<FileOpPair[]> {
  return invoke<FileOpPair[]>('fs_stage_delete', { paths: paths.map(normPath), ...(undoEnabled ? {} : { undoEnabled: false }) })
    .then((pairs) => pairs.map(normalizePair));
}

/** 回退删除：把暂存项移回原位（原位置已占用时该项报错）。 */
export function fsRestoreStaged(items: FileOpPair[]): Promise<FileOpOutcome> {
  return invoke<FileOpOutcome>('fs_restore_staged', { items: items.map(normalizePair) })
    .then(normalizeOutcome);
}

/** 把暂存项送入系统回收站（可回退窗口结束后补完删除）。 */
export function fsPurgeStaged(paths: string[]): Promise<void> {
  return invoke('fs_purge_staged', { paths: paths.map(normPath) });
}

/** 用系统「打开方式」对话框打开文件（Windows 选择器 / macOS 在 Finder 中显示）。 */
export function fileOpenWith(path: string): Promise<void> {
  return invoke('file_open_with', { path: normPath(path) });
}

/** 在系统文件管理器中定位并选中该路径（Windows 资源管理器 / macOS Finder）。 */
export function fileRevealInDir(path: string): Promise<void> {
  return revealItemInDir(path);
}
