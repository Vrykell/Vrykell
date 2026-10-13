import type { FsEntry } from '@platform/api/types';
import type { FileOps } from '../model/fileOps';

export interface FileSearchResult {
  entries: FsEntry[];
  truncated: boolean;
  skipped: number;
}

/** Bounded traversal shared by local and remote file services. */
export async function searchFiles(ops: Pick<FileOps, 'list' | 'search'>, root: string, query: string,
  signal: AbortSignal, onProgress: (result: FileSearchResult) => void): Promise<FileSearchResult> {
  const needle = query.trim().toLocaleLowerCase();
  const result: FileSearchResult = { entries: [], truncated: false, skipped: 0 };
  if (!needle) return result;
  if (signal.aborted) return result;
  if (ops.search) return ops.search(root, query, signal);
  const queue = [{ path: root, depth: 0 }];
  const seen = new Set<string>();
  let scanned = 0;
  while (queue.length && !signal.aborted) {
    if (seen.size >= 500 || scanned >= 20000 || result.entries.length >= 200) {
      result.truncated = true;
      break;
    }
    const directory = queue.shift()!;
    if (seen.has(directory.path)) continue;
    seen.add(directory.path);
    let entries: FsEntry[];
    try { entries = (await ops.list(directory.path)).entries; }
    catch (error) {
      if (directory.path === root) throw error;
      result.skipped++;
      continue;
    }
    if (signal.aborted) break;
    for (const entry of entries) {
      if (++scanned > 20000 || result.entries.length >= 200) { result.truncated = true; break; }
      if (entry.name.toLocaleLowerCase().includes(needle)) result.entries.push(entry);
      if (entry.is_dir && !entry.is_symlink) {
        if (directory.depth < 12 && queue.length < 500) queue.push({ path: entry.path, depth: directory.depth + 1 });
        else result.truncated = true;
      }
    }
    onProgress({ ...result, entries: [...result.entries] });
  }
  return { ...result, entries: [...result.entries] };
}
