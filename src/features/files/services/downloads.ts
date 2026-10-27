import { invoke } from '@platform/diagnostics';

/**
 * Download history API — the backend records a download in the database after a successful ssh_download;
 * the frontend only lists and clears it. Fields use the backend's camelCase naming.
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

/** Discards local download copies left behind by a cancelled drag-out: the backend deletes the files and removes their download history entries. */
export function downloadsDiscard(paths: string[]): Promise<void> {
  return invoke('downloads_discard', { paths });
}
