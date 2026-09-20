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
