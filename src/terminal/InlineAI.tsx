import { Component } from 'react';
import { useChatStore, useActiveMessages } from '../stores/chat';
import Markdown from '../chat/Markdown';

/**
 * 单条消息的 Markdown 渲染保护。
 * remark-gfm 的 transformGfmAutolinkLiterals 在遇到特定字符序列时
 * 会触发 RegExp 构造异常，用 ErrorBoundary 隔离防止整个应用崩溃。
 */
class SafeMarkdown extends Component<{ content: string }> {
  state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  // 流式期间父组件每个 chunk 都重渲染；这里只比较 content，避免已完成消息
  // 每次 token 都重跑整条 Markdown + KaTeX 解析（长对话的主要卡顿源）。
  shouldComponentUpdate(nextProps: { content: string }) {
    return nextProps.content !== this.props.content;
  }

  render() {
    if (this.state.error) {
      return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(无法渲染此消息)</span>;
    }
    return <Markdown content={this.props.content} />;
  }
}

export default function InlineAI() {
  const messages = useActiveMessages();
  const clear = useChatStore((s) => s.clearTab);

  return (
    <div style={{ fontSize: 12 }}>
      {messages.map((msg) => (
        <div key={msg.id} style={{
          padding: msg.role === 'user' ? '4px 16px' : '4px 16px 8px',
          borderBottom: msg.role === 'user' ? '1px solid var(--border)' : 'none',
        }}>
          {msg.role === 'user' ? (
            <UserMessage content={msg.content} />
          ) : (
            <div className="md" style={{ lineHeight: 1.55, color: 'var(--text-primary)' }}>
              <SafeMarkdown content={msg.content} />
              {msg.pending && (
                <span style={{
                  display: 'inline-block',
                  color: 'var(--accent)',
                  animation: 'pulse 1s infinite',
                  marginLeft: 2,
                }}>▍</span>
              )}
            </div>
          )}
        </div>
      ))}
      {messages.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1px 12px' }}>
          <button
            data-subtle
            onClick={() => clear()}
            title="清除当前对话"
            style={{
              fontSize: 10, padding: '2px 8px', border: 'none', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-ui)',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >Clear</button>
        </div>
      )}
    </div>
  );
}

// ── UserMessage — ：带 "You" 标签的用户消息 ──

function UserMessage({ content }: { content: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--accent-blue)',
        fontFamily: 'var(--font-ui)',
        flexShrink: 0,
        minWidth: 28,
        lineHeight: '20px',
      }}>You</span>
      <span style={{
        color: 'var(--text-secondary)',
        fontSize: 12,
        fontFamily: 'var(--font-ui)',
        lineHeight: '20px',
        wordBreak: 'break-word',
      }}>
        {content.slice(0, 300)}{content.length > 300 ? '…' : ''}
      </span>
    </div>
  );
}
