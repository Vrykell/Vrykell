/**
 * AiBlock — 一次 AI 问答交换的渲染（「会话转录」视觉语言）。
 *
 * AI 不是应用里的聊天机器人，而是会话历史里的一种特殊条目：
 *   问题 = 你敲的一行（⚡ prompt + 等宽字体，与命令同级）
 *   回答 = 这行的输出（暖色 gutter 引导线 + UI 字体散文）
 * 零气泡、零卡片 —— gutter 与字体分工是 AI 的全部标识。
 *
 * 同组件服务两个视图：TerminalBlockList（块流内联）与 PanelChat（窗口转录）。
 */

import { useState } from 'react';
import { Copy, RotateCw, Zap } from 'lucide-react';
import { useChatStore } from '../stores/chat';
import SafeMarkdown from './SafeMarkdown';
import type { ChatExchange } from './exchanges';

export default function AiBlock({ exchange }: { exchange: ChatExchange }) {
  const [collapsed, setCollapsed] = useState(false);
  const { question, answer } = exchange;

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  const rerun = () => {
    if (question) useChatStore.getState().send(question.content, { paneId: exchange.paneId });
  };

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

      {/* 回答 — 暖色 gutter + UI 字体；错误态 gutter 转红 */}
      {answer && !collapsed && (
        <div
          style={{
            borderLeft: `2px solid ${answer.error ? 'var(--error)' : 'var(--accent-warm)'}`,
            marginLeft: 5,
            paddingLeft: 12,
            marginTop: 2,
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}
        >
          {answer.content ? (
            <div className="md">
              <SafeMarkdown content={answer.content} />
            </div>
          ) : null}
          {answer.pending && (
            <span
              style={{
                display: 'inline-block',
                color: 'var(--accent-warm)',
                animation: 'pulse 1s infinite',
              }}
            >▍</span>
          )}
        </div>
      )}
    </div>
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
