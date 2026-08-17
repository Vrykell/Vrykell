import { invoke } from '@tauri-apps/api/core';
import type {
  BackendHistoryEntry, BackendFileMatch, BackendSearchContext,
  BackendBlockEntry, BackendSessionEntry,
} from '../search/types';

/** 搜索文件系统 */
export function searchFiles(
  query: string,
  maxResults = 50,
  searchContent = false,
  root?: string,
  roots?: string[],
): Promise<BackendFileMatch[]> {
  return invoke('search_files', {
    query,
    maxResults,
    searchContent,
    root: root ?? null,
    roots: roots ?? null,
  });
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

/** 获取搜索上下文（环境元数据）；cwd 传活跃终端 tab 的工作目录 */
export function getSearchContext(cwd?: string): Promise<BackendSearchContext> {
  return invoke('get_search_context', { cwd: cwd ?? null });
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

/** 获取命令统计（最常用命令） */
export function historyStats(topN = 20): Promise<BackendHistoryEntry[]> {
  return invoke('history_stats', { topN });
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
