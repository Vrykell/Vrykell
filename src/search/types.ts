// ── 结果类型枚举 ──
import type { LucideIcon } from 'lucide-react';

export type ResultType = 'history' | 'block' | 'file' | 'setting' | 'action' | 'session';

// ── 搜索源定义 ──
export interface SearchSource {
  id: ResultType;
  label: string;
  icon: LucideIcon;
  search: (query: string) => Promise<SearchResult[]>;
}

// ── 搜索结果 ──
export interface SearchResult {
  type: ResultType;
  id: string;
  title: string;
  subtitle?: string;
  detail?: string;
  data: SearchResultData;
}

// ── 类型特定数据 ──
export type SearchResultData =
  | HistoryResultData
  | BlockResultData
  | FileResultData
  | SettingResultData
  | ActionResultData
  | SessionResultData;

export interface HistoryResultData {
  command: string;
  cwd: string;
  exitCode: number | null;
  timestamp: number;
  runCount: number;
}

export interface BlockResultData {
  blockId: string;
  tabId: string;
  command: string;
  exitCode: number | null;
  status: 'running' | 'completed' | 'failed';
  startLine: number;
  /** 摘取包含匹配关键词的输出片段 */
  outputSnippet?: { text: string; matchStart: number; matchEnd: number };
  startedAt: number;
  durationMs?: number;
  tabTitle?: string;
  /** 所属会话状态：活跃 / 已关闭 */
  sessionStatus?: 'active' | 'historical';
}

export interface FileResultData {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  matchType: 'name' | 'content' | 'path';
  contentSnippet?: string;
}

export interface SettingResultData {
  settingId: string;
  currentValue: string;
}

export interface ActionResultData {
  commandId: string;
  shortcut?: string;
}

export interface SessionResultData {
  sessionId: string;
  title: string;
  status: string;
  blockCount: number;
}

// ── 后端返回类型 ──
export interface BackendHistoryEntry {
  id: number;
  command: string;
  cwd: string;
  exit_code: number | null;
  timestamp: number;
  run_count: number;
}

export interface BackendFileMatch {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  match_type: string;
  content_snippet: string | null;
}

export interface BackendSearchContext {
  cwd: string;
  home: string;
  shell: string;
  git_branch: string | null;
  project_name: string | null;
}

/** Rust blocks 表 JOIN sessions 返回 */
export interface BackendBlockEntry {
  id: string;
  session_id: string;
  pane_id: string | null;
  command: string;
  output_raw: string;
  output_clean: string;
  exit_code: number | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  session_title: string;
  session_status: string;
  /** block 是否被用户折叠（恢复时回读） */
  collapsed: boolean;
}

/** Rust sessions 表返回 */
export interface BackendSessionEntry {
  id: string;
  title: string;
  status: string;
  created_at: number;
  closed_at: number | null;
  block_count: number;
  cwd: string;
  group_id: string | null;
  sort_order: number;
  /** 会话类型判别：local | ssh */
  kind: string;
  /** 变体专属数据的 JSON 字符串 */
  payload: string;
}

/** Rust groups 表返回 */
export interface BackendGroupEntry {
  id: string;
  title: string;
  sort_order: number;
  collapsed: boolean;
  created_at: number;
  session_count: number;
  archived: boolean;
}
