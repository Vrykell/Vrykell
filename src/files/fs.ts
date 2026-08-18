import { invoke } from '@tauri-apps/api/core';

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export function fsList(path?: string): Promise<FsEntry[]> {
  return invoke('fs_list', { path: path ?? null });
}

/** 列出文件系统根（Windows 盘符 / Unix `/`）。 */
export function fsRoots(): Promise<FsEntry[]> {
  return invoke('fs_roots');
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
