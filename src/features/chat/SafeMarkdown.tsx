import { Component } from 'react';
import Markdown from './Markdown';

/**
 * 单条消息的 Markdown 渲染保护。
 * remark-gfm 的 transformGfmAutolinkLiterals 在遇到特定字符序列时
 * 会触发 RegExp 构造异常，用 ErrorBoundary 隔离防止整个应用崩溃。
 * （自 InlineAI 迁入，供 AiBlock / PanelChat 共用）
 *
 * 降级策略：渲染失败不吞消息 —— 展示原始文本（等宽、可选中），
 * 并把错误 + 内容摘要打进 console 便于定位。
 */
export default class SafeMarkdown extends Component<{ content: string }, { error: boolean; errorMessage: string; content: string }> {
  state = { error: false, errorMessage: '', content: this.props.content };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: true,
      errorMessage: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    console.error(
      '[SafeMarkdown] 渲染失败:',
      error,
      '\n内容摘要:', JSON.stringify(this.props.content.slice(0, 300)),
      '\n组件栈:', info.componentStack ?? '(无)',
    );
  }

  // 流式中间态可能触发渲染异常（如不完整的数学公式），
  // 内容更新时复位 error —— 否则一次中间态错误会让整条消息永远降级。
  static getDerivedStateFromProps(props: { content: string }, state: { content: string }) {
    return props.content !== state.content
      ? { error: false, errorMessage: '', content: props.content }
      : null;
  }

  // 流式期间父组件每个 chunk 都重渲染；这里只比较 content，避免已完成消息
  // 每次 token 都重跑整条 Markdown + KaTeX 解析（长对话的主要卡顿源）。
  shouldComponentUpdate(nextProps: { content: string }) {
    return nextProps.content !== this.props.content;
  }

  render() {
    if (this.state.error) {
      return (
        <div>
          <span style={{ color: 'var(--error)', fontStyle: 'italic', fontSize: 11 }}>
            渲染失败（{this.state.errorMessage}），以下为原文：
          </span>
          <pre
            data-selectable
            style={{
              margin: '4px 0 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            {this.props.content}
          </pre>
        </div>
      );
    }
    return <Markdown content={this.props.content} />;
  }
}
