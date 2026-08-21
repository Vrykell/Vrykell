/**
 * AiBlock — 一次 AI 问答交换的渲染（「时间轴 rail」视觉语言）。
 *
 * AI 不是应用里的聊天机器人，而是会话历史里的一种特殊条目：
 *   问题 = 你敲的一行（⚡ prompt + 等宽字体，与命令同级）
 *   回答 = 时间轴：每个动作（执行命令/读取/修改/搜索…）挂一个 8px 状态
 *          节点 + 摘要卡片；1px 中性细线（rail）只存在于节点之间 ——
 *          细线的两个端点恰是首/末节点的圆心，不探出头；节点之前的
 *          文本段无线。run_command 节点下内嵌命令输出块。
 * 节点语义：绿实心=成功 / 红实心=失败 / 暖色描边环脉冲=执行中 /
 *          静态暖色环=等待批准 / 灰环=已拒绝。纯文本不设节点（也无细线）。
 *
 * 行结构：回答区每个 part 包一层行容器（position:relative; paddingLeft:16），
 * 行容器左缘即 rail x 坐标；RailSeg（本文件）与 ToolNode（ToolRunCard 内）
 * 都以它为包含块。错误行是合成的末节点（红实心 +「出错了」）。
 *
 * 同组件服务两个视图：TerminalBlockList（块流内联）与 PanelChat（窗口转录）。
 */

import { useState } from 'react';
import { Copy, RotateCw, Zap } from 'lucide-react';
import { useChatStore } from '../stores/chat';
import SafeMarkdown from './SafeMarkdown';
import ToolNode from './ToolNode';
import ToolRunCard from './ToolRunCard';
import type { ChatExchange } from './exchanges';

/** rail 线段：1px 细线，位于行容器左缘。up/down 控制是否向行首/行尾延伸，
 *  都不延伸时线段收在节点圆心处（即不渲染）。nodeTop = 节点圆心的行内偏移。 */
function RailSeg({ up, down, nodeTop = 12 }: { up: boolean; down: boolean; nodeTop?: number }) {
  if (!up && !down) return null;
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        width: 1,
        transform: 'translateX(-50%)',
        top: up ? 0 : nodeTop,
        bottom: down ? 0 : nodeTop,
        background: 'var(--border-strong)',
      }}
    />
  );
}

export default function AiBlock({ exchange }: { exchange: ChatExchange }) {
  const [collapsed, setCollapsed] = useState(false);
  const { question, answer } = exchange;

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  const rerun = () => {
    if (question) useChatStore.getState().send(question.content, { paneId: exchange.paneId });
  };

  // 首/末动作节点的 part 下标（错误行是更靠后的合成节点）
  const parts = answer?.parts;
  const toolIdxs = (parts ?? []).flatMap((p, i) => (p.kind === 'tool' ? [i] : []));
  const firstNode = toolIdxs[0] ?? -1;
  const lastNode = toolIdxs[toolIdxs.length - 1] ?? -1;
  const hasErrorNode = !!answer?.error;

  return (
    <div className="ai-block" style={{ padding: '4px 0 2px' }}>
      {/* 问题行 — ⚡ prompt + mono，点击折叠/展开回答 */}
      {question && (
        <div
          onClick={() => answer && setCollapsed((c) => !c)}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            padding: '2px 0',
            cursor: answer ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          <Zap size={12} style={{ color: 'var(--accent-warm)', flexShrink: 0, transform: 'translateY(1px)' }} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--text-primary)',
              lineHeight: '20px',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            {question.content}
          </span>
          {/* hover 动作：重新提问 / 复制（ai-block:hover 控制显隐） */}
          <span className="ai-block-actions" style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            {question && <ActionBtn title="重新提问" onClick={rerun}><RotateCw size={11} /></ActionBtn>}
            <ActionBtn title="复制" onClick={() => copy(answer?.content || question.content)}><Copy size={11} /></ActionBtn>
          </span>
        </div>
      )}

      {/* 回答 — 时间轴：节点间细线 + 文本段 + 动作卡片（含内嵌命令块） */}
      {answer && !collapsed && (
        <div
          style={{
            marginLeft: 6,
            marginTop: 2,
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}
        >
          {parts
            ? parts.map((p, i) => {
                if (p.kind === 'tool') {
                  // 线段收在首/末节点圆心；有错误节点时末张卡片向下续线
                  return (
                    <div key={p.tool.toolCallId} style={{ position: 'relative', paddingLeft: 16 }}>
                      <RailSeg up={i > firstNode} down={i < lastNode || hasErrorNode} />
                      <ToolRunCard run={p.tool} paneId={exchange.paneId} />
                    </div>
                  );
                }
                if (!p.text) return null;
                const isLast = i === parts.length - 1;
                // 文本段：仅当它位于两个节点之间时细线穿过（全高）；
                // 首节点之前/末节点之后的文本无线（细线端点收在节点圆心）
                const between = firstNode >= 0 && i > firstNode && (i < lastNode || hasErrorNode);
                return (
                  <div key={i} style={{ position: 'relative', paddingLeft: 16 }}>
                    <RailSeg up={between} down={between} />
                    <div className="md">
                      <SafeMarkdown content={p.text} />
                      {/* pending 光标落在最后一个 text part 末尾 */}
                      {isLast && answer.pending && <PendingCursor />}
                    </div>
                  </div>
                );
              })
            : // legacy 渲染（纯文本/旧持久化消息）：无节点无细线，行为零变化
              answer.content && (
                <div style={{ paddingLeft: 16 }} className="md">
                  <SafeMarkdown content={answer.content} />
                  {answer.pending && <PendingCursor />}
                </div>
              )}
          {/* 末 part 是 tool 时，pending 光标挂在尾部独立一行（非节点，无线） */}
          {parts && answer.pending && parts[parts.length - 1]?.kind === 'tool' && (
            <div style={{ paddingLeft: 16 }}>
              <PendingCursor />
            </div>
          )}
          {/* 文本错误 = 合成末节点（红实心 +「出错了」），细线向上续到它 */}
          {answer.error && (
            <div
              style={{
                position: 'relative',
                paddingLeft: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingTop: 3,
                paddingBottom: 3,
                lineHeight: '18px',
              }}
            >
              <RailSeg up={firstNode >= 0} down={false} />
              <ToolNode state="error" top={12} />
              <span style={{ fontSize: 12, color: 'var(--error)' }}>出错了</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 流式 pending 光标（暖色 ▍ 脉冲） */
function PendingCursor() {
  return (
    <span
      style={{
        display: 'inline-block',
        color: 'var(--accent-warm)',
        animation: 'pulse 1s infinite',
      }}
    >
      ▍
    </span>
  );
}

function ActionBtn({ title, onClick, children }: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-subtle
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        padding: 0,
        border: 'none',
        borderRadius: 3,
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--button-hover)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      {children}
    </button>
  );
}
