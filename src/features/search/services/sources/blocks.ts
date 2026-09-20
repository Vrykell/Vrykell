import { SquareTerminal } from 'lucide-react';
import { registerSource } from '@features/search/services/registry';
import type { BackendBlockEntry } from '@platform/api/types';
import type { SearchResult, BlockResultData } from '@features/search/types';
import { searchBlocks } from '@platform/api/search';
import { fmtDuration } from '@ui/UiBtn';

/** 去除 ANSI 转义序列，提取纯文本 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 从输出中提取包含匹配关键词的片段（最多 100 字符，居中匹配位置） */
function extractSnippet(
  output: string,
  queryLower: string,
  maxLen = 100,
): { text: string; matchStart: number; matchEnd: number } | undefined {
  const clean = stripAnsi(output).trim();
  if (!clean) return undefined;
  const lower = clean.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx === -1) return undefined;

  const qLen = queryLower.length;
  const half = Math.floor((maxLen - qLen) / 2);
  let start = Math.max(0, idx - half);
  const end = Math.min(clean.length, idx + qLen + half);
  // 调整到单词边界
  if (start > 0 && clean[start] !== ' ' && clean[start - 1] !== ' ') {
    start = Math.max(0, start - 10);
  }

  const text = (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
  const matchStart = (start > 0 ? 1 : 0) + (idx - start);
  const matchEnd = matchStart + qLen;

  return { text, matchStart, matchEnd };
}

registerSource({
  id: 'block',
  label: '终端输出',
  icon: SquareTerminal,
  search: async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    const backend = await searchBlocks(query, 20, null).catch(() => [] as BackendBlockEntry[]);

    return backend.map((b: BackendBlockEntry) => {
      const cmdMatch = b.command.toLowerCase().includes(query.toLowerCase());
      const displayOutput = b.output_clean || b.output_raw;
      const snippet = cmdMatch
        ? undefined
        : extractSnippet(displayOutput, query.toLowerCase());

      return {
        type: 'block',
        id: b.id,
        title: b.command || '(no command)',
        subtitle: cmdMatch ? undefined : (snippet?.text ?? stripAnsi(displayOutput).slice(0, 80)),
        detail: b.started_at
          ? `${b.session_title} · ${fmtDuration(Date.now() - b.started_at)}前`
          : b.session_title,
        data: {
          blockId: b.id,
          tabId: b.session_id,
          command: b.command,
          exitCode: b.exit_code,
          status: (b.status === 'executing' || b.status === 'running' ? 'running'
            : b.exit_code === 0 ? 'completed'
            : 'failed') as 'running' | 'completed' | 'failed',
          startLine: 0,
          outputSnippet: snippet,
          startedAt: b.started_at,
          durationMs: b.ended_at != null ? b.ended_at - b.started_at : undefined,
          tabTitle: b.session_title,
          sessionStatus: b.session_status as 'active' | 'historical',
        } as BlockResultData,
      };
    });
  },
});
