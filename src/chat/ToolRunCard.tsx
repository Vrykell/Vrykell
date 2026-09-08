/**
 * ToolRunCard — 单个工具动作的行内卡片（零浮层）。
 *
 * 折叠态 = 单行摘要：动作图标 + 摘要文本 + 右侧状态 chip；
 * 点击行内展开（所有工具统一，含 run_command）：
 *   run_command → 命令输出块（圆角深底 + BlockOutput，与终端输出块同款）
 *   其余工具   → 输出尾部 pre（maxHeight 240，超长截断提示「…仅显示尾部」）
 * 展开态是组件内 useState，不进 store。
 *
 * 定位约定：本卡根节点是静态流式元素；ToolNode（absolute）与 rail 线段
 * 都由 AiBlock 的行容器（position:relative; paddingLeft:16）承载。
 */

import {
  Brain,
  Check,
  FileText,
  Folder,
  Globe,
  Pencil,
  Search,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { agentControl } from '@/agent/agentControl';
import type { ToolRun, ToolRunState } from '@/agent/messageParts';
import { resolveApproval } from '@/agent/permissions';
import ToolNode from '@/chat/ToolNode';
import { useBlockStore } from '@/store/blocks';
import BlockOutput from '@/terminal/BlockOutput';

const STATE_CHIP: Record<ToolRunState, { label: string; color: string }> = {
  running: { label: '执行中', color: 'var(--accent-warm)' },
  'approval-pending': { label: '等待批准', color: 'var(--accent-warm)' },
  done: { label: '成功', color: 'var(--success)' },
  error: { label: '失败', color: 'var(--error)' },
  denied: { label: '已拒绝', color: 'var(--text-muted)' },
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 单行摘要（TOOL_SUMMARY 查表，未知工具 Wrench 兜底） */
function summarize(run: ToolRun): { icon: React.ReactNode; text: string } {
  const i = run.input;
  const s = { size: 11, color: 'var(--text-muted)' } as const;
  switch (run.toolName) {
    case 'run_command':
      return { icon: <Terminal {...s} />, text: `$ ${str(i.command)}` };
    case 'read_file':
      return { icon: <FileText {...s} />, text: `读取 ${str(i.path)}` };
    case 'edit_file':
      return { icon: <Pencil {...s} />, text: `修改 ${str(i.path)}` };
    case 'write_file':
      return { icon: <Pencil {...s} />, text: `写入 ${str(i.path)}` };
    case 'search_files':
      return { icon: <Search {...s} />, text: `搜索 ${str(i.query)}` };
    case 'list_dir':
      return { icon: <Folder {...s} />, text: `列目录 ${str(i.path)}` };
    case 'web_search':
      return { icon: <Globe {...s} />, text: `联网搜索 ${str(i.query)}`.trim() };
    case 'google_search':
      // gemini 原生搜索：provider 服务端执行，input 通常为空
      return { icon: <Globe {...s} />, text: `联网搜索 ${str(i.query)}`.trim() };
    case 'web_fetch':
      return { icon: <Globe {...s} />, text: `抓取 ${str(i.url)}` };
    case 'think':
      return { icon: <Brain {...s} />, text: '思考' };
    default:
      return { icon: <Wrench {...s} />, text: run.toolName };
  }
}

/** run_command 的 output 是 {ok, exitCode, output} JSON；其余工具原样展示 */
function expandBody(run: ToolRun): { exitCode?: number; body: string } {
  const raw = run.error ?? run.output ?? '';
  if (run.toolName === 'run_command' && run.output && !run.error) {
    try {
      const v = JSON.parse(run.output) as { exitCode?: number; output?: string };
      return { exitCode: v.exitCode, body: v.output ?? '' };
    } catch {
      /* fallthrough：按原文展示 */
    }
  }
  return { body: raw };
}

const BODY_CAP = 6000;

/** run_command 展开态输出块：圆角深底容器 + BlockOutput（与终端输出块同款）。
 *  活块优先（含 outputHtml 颜色快照）；映射丢失（重启）降级 captured 文本。 */
function CommandOutputBlock({ run, paneId }: { run: ToolRun; paneId?: string }) {
  const block = useBlockStore((s) => {
    const id = agentControl.blockForToolCall(run.toolCallId);
    if (!id || !paneId) return undefined;
    return (s.byTab[paneId] ?? []).find((b) => b.id === id);
  });

  const { body: captured } = expandBody(run);
  const running = run.state === 'running' || run.state === 'approval-pending';

  let content: React.ReactNode;
  if (block?.outputHtml) {
    content = <BlockOutput text={block.outputHtml} isHtml maxHeight={240} />;
  } else if (block?.outputText) {
    content = <BlockOutput text={block.outputText} maxHeight={240} />;
  } else if (run.error) {
    content = <span style={{ color: 'var(--error-light)' }}>{run.error}</span>;
  } else if (running && block) {
    content = <span style={{ color: 'var(--text-muted)' }}>命令执行中…</span>;
  } else if (captured) {
    content = <BlockOutput text={captured} maxHeight={240} />;
  } else if (running) {
    content = <span style={{ color: 'var(--text-muted)' }}>命令执行中…</span>;
  } else {
    content = <span style={{ color: 'var(--text-muted)' }}>（无输出）</span>;
  }

  return (
    <div
      style={{
        margin: '2px 0 6px',
        borderRadius: 8,
        background: 'var(--block)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      {content}
    </div>
  );
}

export default function ToolRunCard({ run, paneId }: { run: ToolRun; paneId?: string }) {
  const [open, setOpen] = useState(false);
  const { icon, text } = summarize(run);
  const chip = STATE_CHIP[run.state];
  const { exitCode, body } = expandBody(run);
  const isCommand = run.toolName === 'run_command';
  // 所有工具统一为「单行摘要 + 点击行内展开」；run_command 展开态是命令输出块
  const expandable = isCommand || body.length > 0;
  const truncated = body.length > BODY_CAP;
  const shown = truncated ? body.slice(-BODY_CAP) : body;

  return (
    <div>
      {/* 节点压在 rail 上（left:0 = 行容器左缘 = rail），top 对齐摘要首行中心 */}
      <ToolNode state={run.state} top={12} />
      {/* 摘要行（点击行内展开） */}
      <div
        onClick={() => expandable && setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 0',
          cursor: expandable ? 'pointer' : 'default',
          userSelect: 'none',
          lineHeight: '18px',
        }}
      >
        {icon}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}
        >
          {text}
        </span>
        {/* run_command 的 exit 徽标（对齐 BlockItem 模式） */}
        {isCommand && exitCode != null && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: exitCode === 0 ? 'var(--success)' : 'var(--error)',
              flexShrink: 0,
            }}
          >
            {exitCode === 0 ? <Check size={10} /> : <X size={10} />}
            {exitCode}
          </span>
        )}
        <span style={{ fontSize: 10, color: chip.color, flexShrink: 0 }}>{chip.label}</span>
      </div>

      {/* M3 审批行：等待批准时行内三按钮（零浮层），危险命令附原因 */}
      {run.state === 'approval-pending' && (
        <div style={{ margin: '2px 0 6px' }}>
          {run.danger && (
            <div style={{ fontSize: 11, color: 'var(--accent-warm)', marginBottom: 4 }}>
              ⚠ {run.danger}，确认后再放行
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{
                fontSize: 11,
                padding: '2px 10px',
                borderColor: 'var(--accent-warm)',
                color: 'var(--accent-warm)',
              }}
              onClick={() => resolveApproval(run.toolCallId, 'once')}
            >
              允许一次
            </button>
            <button
              style={{ fontSize: 11, padding: '2px 10px' }}
              onClick={() => resolveApproval(run.toolCallId, 'session')}
            >
              本会话允许
            </button>
            <button
              style={{ fontSize: 11, padding: '2px 10px', color: 'var(--error-light)' }}
              onClick={() => resolveApproval(run.toolCallId, 'deny')}
            >
              拒绝
            </button>
          </div>
        </div>
      )}

      {/* 展开态：run_command = 命令输出块；其余工具 = 输出/错误尾部 pre */}
      {open && isCommand && <CommandOutputBlock run={run} paneId={paneId} />}
      {open && !isCommand && expandable && (
        <pre
          data-selectable
          style={{
            margin: '2px 0 6px',
            padding: '6px 8px',
            background: 'var(--block)',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.5,
            color: run.state === 'error' ? 'var(--error-light)' : 'var(--text-secondary)',
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {truncated ? '…仅显示尾部\n' : ''}
          {shown}
        </pre>
      )}
    </div>
  );
}
