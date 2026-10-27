// ── Result type enum ──
import type { AppIcon } from '@ui/icons';

export type ResultType = 'history' | 'block' | 'file' | 'setting' | 'action' | 'session';

// ── Search source definition ──
export interface SearchSource {
  id: ResultType;
  label: string;
  icon: AppIcon;
  search: (query: string, options?: { signal: AbortSignal; onProgress: (results: SearchResult[]) => void }) => Promise<SearchResult[]>;
}

// ── Search result ──
export interface SearchResult {
  type: ResultType;
  id: string;
  title: string;
  subtitle?: string;
  detail?: string;
  data: SearchResultData;
}

// ── Type-specific data ──
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
  /** Output snippet containing the matched keyword */
  outputSnippet?: { text: string; matchStart: number; matchEnd: number };
  startedAt: number;
  durationMs?: number;
  tabTitle?: string;
  /** Owning session status: active / closed */
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
