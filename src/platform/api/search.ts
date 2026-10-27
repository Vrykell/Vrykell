import { invoke } from '@platform/diagnostics';
import { Channel } from '@tauri-apps/api/core';
import { normPath } from '@platform/path';
import type {
  BackendHistoryEntry, BackendFileMatch, BackendBlockEntry, BackendSessionEntry,
} from '@platform/api/types';

/** Searches the filesystem; search roots and result paths are normalized at the boundary. */
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

/** Searches command history. */
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

/** Records a command in the backend history. */
export function recordHistory(
  command: string,
  cwd: string,
  exitCode: number | null,
  timestamp: number,
): Promise<void> {
  return invoke('record_history', { command, cwd, exitCode, timestamp });
}

/** Clears command history. */
export function clearHistory(): Promise<void> {
  return invoke('clear_history');
}

/** Searches command blocks by keyword (joined with sessions for title/status). */
export function searchBlocks(
  query: string, maxResults = 20, filterSessionStatus?: string | null,
): Promise<BackendBlockEntry[]> {
  return invoke('search_blocks', {
    query, maxResults, filterSessionStatus: filterSessionStatus ?? null,
  });
}

/** Searches sessions by title. */
export function searchSessions(query: string, maxResults = 10): Promise<BackendSessionEntry[]> {
  return invoke('search_sessions', { query, maxResults });
}
