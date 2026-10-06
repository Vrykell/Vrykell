import { invoke } from '@platform/diagnostics';
import { normPath } from '@platform/path';
import type { FsEntry, DiskEntry } from '@platform/api/types';

export type { FsEntry, DiskEntry };

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

export function fsRename(oldPath: string, newName: string): Promise<void> {
  return invoke('fs_rename', { oldPath: normPath(oldPath), newName });
}

export function fsDelete(path: string): Promise<void> {
  return invoke('fs_delete', { path: normPath(path) });
}

/** 用系统「打开方式」对话框打开文件（Windows 选择器 / macOS 在 Finder 中显示）。 */
export function fileOpenWith(path: string): Promise<void> {
  return invoke('file_open_with', { path: normPath(path) });
}
