import { invoke } from '@platform/diagnostics';

/**
 * 下载历史 API —— 下载记录由后端在 ssh_download 成功后写入 SQLite，
 * 前端这里只负责列出 / 清空。字段为后端 serde camelCase。
 */
export interface DownloadEntry {
  id: number;
  name: string;
  localPath: string;
  remotePath: string;
  connectionName: string;
  isDir: boolean;
  size: number;
  downloadedAt: number;
}

export function downloadsList(): Promise<DownloadEntry[]> {
  return invoke('downloads_list');
}

export function downloadsClear(): Promise<void> {
  return invoke('downloads_clear');
}

export function downloadsDelete(id: number): Promise<void> {
  return invoke('downloads_delete', { id });
}

/** 丢弃拖出取消后遗留的本地下载副本：后端删除文件并移除对应下载历史。 */
export function downloadsDiscard(paths: string[]): Promise<void> {
  return invoke('downloads_discard', { paths });
}
