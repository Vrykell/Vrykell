import { invoke } from '@platform/diagnostics';
import { Channel } from '@tauri-apps/api/core';
import { normPath } from '@platform/path';
import type {
  BackendHistoryEntry, BackendFileMatch, BackendBlockEntry, BackendSessionEntry,
} from '@platform/api/types';

/** 搜索文件系统；搜索根与结果路径在边界处归一化。 */
export async function searchFiles(
  query: string,
  maxResults = 50,
  searchContent = false,
  root?: string,
  roots?: string[],
  options?: { signal: AbortSignal; onProgress: (matches: BackendFileMatch[]) => void },
): Promise<BackendFileMatch[]> {
  if (options?.signal.aborted) return [];
  const normalize = (matches: BackendFileMatch[]) => matches.map(match => ({ ...match, path: normPath(match.path) }));
  const requestId = options ? crypto.randomUUID() : undefined;
  const progress = options ? new Channel<BackendFileMatch[]>() : undefined;
  if (progress) progress.onmessage = matches => { if (!options?.signal.aborted) options?.onProgress(normalize(matches)); };
  const cancel = () => { void invoke('search_files_cancel', { requestId }).catch(() => {}); };
  options?.signal.addEventListener('abort', cancel, { once: true });
  try { return normalize(await invoke<BackendFileMatch[]>('search_files', {
    query,
    maxResults,
    searchContent,
    root: root == null ? null : normPath(root),
    roots: roots == null ? null : roots.map(normPath),
    ...(progress ? { requestId, onProgress: progress } : {}),
  })); }
  finally { options?.signal.removeEventListener('abort', cancel); if (progress) progress.onmessage = () => {}; }
}

/** 搜索命令历史 */
export function searchHistory(
  query: string,
  maxResults = 30,
  filterExitCode?: number | null,
  since?: number | null,
  cwd?: string | null,
): Promise<BackendHistoryEntry[]> {
  return invoke('search_history', {
    query,
    maxResults,
    filterExitCode: filterExitCode ?? null,
    since: since ?? null,
    cwd: cwd ?? null,
  });
}

/** 记录命令到后端 SQLite 历史 */
export function recordHistory(
  command: string,
  cwd: string,
  exitCode: number | null,
  timestamp: number,
): Promise<void> {
  return invoke('record_history', { command, cwd, exitCode, timestamp });
}

/** 清空命令历史 */
export function clearHistory(): Promise<void> {
  return invoke('clear_history');
}

/** 按关键词搜索命令块（联表 sessions 拿标题/状态） */
export function searchBlocks(
  query: string, maxResults = 20, filterSessionStatus?: string | null,
): Promise<BackendBlockEntry[]> {
  return invoke('search_blocks', {
    query, maxResults, filterSessionStatus: filterSessionStatus ?? null,
  });
}

/** 按标题搜索会话 */
export function searchSessions(query: string, maxResults = 10): Promise<BackendSessionEntry[]> {
  return invoke('search_sessions', { query, maxResults });
}
