import { invoke } from '@tauri-apps/api/core';

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export function fsList(path?: string): Promise<FsEntry[]> {
  return invoke('fs_list', { path: path ?? null });
}

export function fsRename(oldPath: string, newName: string): Promise<void> {
  return invoke('fs_rename', { oldPath, newName });
}

export function fsDelete(path: string): Promise<void> {
  return invoke('fs_delete', { path });
}
