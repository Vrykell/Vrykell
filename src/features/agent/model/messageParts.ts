import { t } from '@i18n';

/**
 * messageParts — 助手消息的 parts 模型（M1 数据基座）。
 *
 * ChatMessage.content 语义不变（= 全部 text part 拼接），它是模型 history、
 * 复制按钮、DB content 列的唯一文本源；parts 只是渲染增强层（rail 上的
 * 文本段/动作条目），与 content 两写同步（chat store 负责）。
 *
 * 隐形契约：纯文本回答的 parts 恒为 undefined（AiBlock 据此选渲染分支）。
 * 唯一物化点 = chat store 的 upsertToolPart（首个工具事件到达时用当前
 * content 重建首 text part）。别处不要给 assistant 消息写 parts: []。
 *
 * 持久化：parts JSON 序列化进 DB chat_messages.parts 列，'' 表示无。
 */

export type ToolRunState = 'approval-pending' | 'input-pending' | 'running' | 'done' | 'error' | 'denied';

export const DEFAULT_TOOL_COMMAND_TIMEOUT_MS = 120_000;

export interface ToolRun {
  toolCallId: string;
  toolName: string; // 'run_command' | 'read_file' | ...
  input: Record<string, unknown>;
  state: ToolRunState;
  /** 结构化结果序列化（≤8KB 截断）；run_command = {ok, exitCode, output} JSON */
  output?: string;
  error?: string;
  /** 危险命令命中原因（M3 审批卡展示「⚠ …」）；仅 run_command 可能有 */
  danger?: string;
  /** 后端派生的命令形态（如 `npm run`）：审批卡据此提供「本会话允许这一种」 */
  shape?: string;
  startedAt: number;
  endedAt?: number;
}

export type MessagePart = { kind: 'text'; text: string } | { kind: 'tool'; tool: ToolRun };

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
  schedule: '定时任务',
  subagent: '子代理',
  think: '思考',
};

const STATE_LABEL: Record<ToolRunState, string> = {
  'input-pending': 'Awaiting answer',
  'approval-pending': '等待批准',
  running: '执行中',
  done: '成功',
  error: '失败',
  denied: '已拒绝',
};

/**
 * parts → 单行工具摘要，追加在 content 后喂给后续轮次的模型，
 * 让它知道本轮做过什么。（真实的 ToolCall/ToolResult ModelMessage
 * 双向映射留到 M2+；M1 务实方案。）
 */
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
