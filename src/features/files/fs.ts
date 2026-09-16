import { invoke } from '@tauri-apps/api/core';

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export function fsList(path?: string): Promise<FsEntry[]> {
  return invoke('fs_list', { path: path ?? null });
}

/** 磁盘条目（「此电脑」视图小卡片展示用）。 */
export interface DiskEntry {
  name: string;
  path: string;
  total_bytes: number;
  free_bytes: number;
}

/** 列出磁盘（macOS 根卷+挂载卷 / Windows 盘符），附带容量信息。 */
export function fsDisks(): Promise<DiskEntry[]> {
  return invoke('fs_disks');
}

/** 用户主目录路径。 */
export function fsHome(): Promise<string> {
  return invoke('fs_home');
}

export function fsRename(oldPath: string, newName: string): Promise<void> {
  return invoke('fs_rename', { oldPath, newName });
}

export function fsDelete(path: string): Promise<void> {
  return invoke('fs_delete', { path });
}

/** 用系统「打开方式」对话框打开文件（Windows 选择器 / macOS 在 Finder 中显示）。 */
export function fileOpenWith(path: string): Promise<void> {
  return invoke('file_open_with', { path });
}
