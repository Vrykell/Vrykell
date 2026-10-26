import { t } from '@i18n';
import type { ModelMessage } from 'ai';

/**
 * Transcript parts preserve text/tool order and complete model results in the existing
 * message storage column. Plain-text answers leave parts undefined. The display preview
 * is independent of the complete result used to recreate model history.
 */

export type ToolRunState = 'approval-pending' | 'input-pending' | 'running' | 'done' | 'error' | 'denied' | 'cancelled';

export const DEFAULT_TOOL_COMMAND_TIMEOUT_MS = 120_000;

export interface ToolRun {
  toolCallId: string;
  toolName: string; // 'run_command' | 'read_file' | ...
  input: Record<string, unknown>;
  state: ToolRunState;
  /** Bounded display preview; complete results belong to modelOutput. */
  output?: string;
  /** Complete serialized result for model history, independent of the display preview. */
  modelOutput?: string;
  providerExecuted?: boolean;
  error?: string;
  /** 危险命令命中原因（M3 审批卡展示「⚠ …」）；仅 run_command 可能有 */
  danger?: string;
  /** 后端派生的命令形态（如 `npm run`）：审批卡据此提供「本会话允许这一种」 */
  shape?: string;
  startedAt: number;
  endedAt?: number;
}

export type MessagePart = { kind: 'text'; text: string } | { kind: 'tool'; tool: ToolRun };

/** Recreate standard call/result pairs in transcript order; history never executes a tool. */
export function partsToModelMessages(content: string, parts?: MessagePart[]): ModelMessage[] {
  if (!parts?.some(part => part.kind === 'tool')) return [{ role: 'assistant', content }];
  const messages: ModelMessage[] = [];
  const ids = new Set<string>();
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text) messages.push({ role: 'assistant', content: part.text });
      continue;
    }
    const run = part.tool;
    if (!run.toolCallId || !run.toolName || ids.has(run.toolCallId)) continue;
    ids.add(run.toolCallId);
    const value = run.modelOutput ?? run.output ?? run.error ?? 'This call was interrupted. No completed result is available.';
    messages.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: run.toolCallId,
      toolName: run.toolName, input: run.input, ...(run.providerExecuted ? { providerExecuted: true } : {}) }] });
    messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: run.toolCallId, toolName: run.toolName,
      output: { type: run.state === 'error' ? 'error-text' : 'text', value } }] });
  }
  return messages;
}

/** parts → DB 字符串；空/undefined → ''（省空间且与旧数据同形） */
export function serializeParts(parts?: MessagePart[]): string {
  return parts && parts.length > 0 ? JSON.stringify(parts) : '';
}

/** DB 字符串 → parts；''/脏 JSON/非数组 → undefined（旧数据走 legacy 渲染） */
export function deserializeParts(raw: string): MessagePart[] | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || v.length === 0) return undefined;
    const valid = v.every((part: unknown) => {
      if (!part || typeof part !== 'object' || !('kind' in part)) return false;
      if (part.kind === 'text') return 'text' in part && typeof part.text === 'string';
      if (part.kind !== 'tool' || !('tool' in part) || !part.tool || typeof part.tool !== 'object') return false;
      const run = part.tool as Record<string, unknown>;
      return typeof run.toolCallId === 'string' && typeof run.toolName === 'string' && typeof run.startedAt === 'number'
        && typeof run.state === 'string' && ['approval-pending', 'input-pending', 'running', 'done', 'error', 'denied', 'cancelled'].includes(run.state)
        && !!run.input && typeof run.input === 'object' && !Array.isArray(run.input)
        && ['output', 'modelOutput', 'error', 'danger', 'shape'].every(key => run[key] === undefined || typeof run[key] === 'string');
    });
    if (!valid) return undefined;
    return v as MessagePart[];
  } catch {
    return undefined;
  }
}

const TOOL_LABEL: Record<string, string> = {
  run_command: '执行命令',
  read_file: '读取文件',
  edit_file: '修改文件',
  write_file: '写入文件',
  search_files: '搜索',
  list_dir: '列目录',
  web_search: '联网搜索',
  google_search: '联网搜索',
  web_fetch: '抓取网页',
  web_crawl: '爬取网页',
  read_terminal: '读取终端',
  terminal_keys: '终端按键',
  use_skill: '调用技能',
  install_skill: '安装技能',
  mcp: 'MCP 工具',
  memory: '记忆',
  think: '思考',
};

const STATE_LABEL: Record<ToolRunState, string> = {
  'input-pending': 'Awaiting answer',
  'approval-pending': '等待批准',
  running: '执行中',
  done: '成功',
  error: '失败',
  denied: '已拒绝',
  cancelled: t('Cancelled'),
};

/** Build a compact display/export summary; model history uses full call/result pairs. */
export function partsToHistoryText(parts?: MessagePart[]): string {
  if (!parts) return '';
  const lines: string[] = [];
  for (const p of parts) {
    if (p.kind !== 'tool') continue;
    const label = TOOL_LABEL[p.tool.toolName] ?? p.tool.toolName;
    if (p.tool.toolName === 'ask_user') {
      lines.push(`[${t('Ask the user')}: ${String(p.tool.input.question ?? '').slice(0, 2000)} → ${STATE_LABEL[p.tool.state]}]`);
      try {
        const result: unknown = JSON.parse(p.tool.output ?? '{}');
        if (result && typeof result === 'object' && 'answer' in result && typeof result.answer === 'string') lines.push(`${t('Your answer')}: ${result.answer.slice(0, 4000)}`);
      } catch { continue; }
      continue;
    }
    const target =
      typeof p.tool.input.command === 'string'
        ? p.tool.input.command
        : typeof p.tool.input.path === 'string'
          ? p.tool.input.path
          : typeof p.tool.input.query === 'string'
            ? p.tool.input.query
            : '';
    lines.push(
      `[${label}${target ? `: ${target}` : ''} → ${STATE_LABEL[p.tool.state]}]`,
    );
  }
  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}
