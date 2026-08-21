import { Component } from 'react';
import Markdown from './Markdown';

/**
 * 单条消息的 Markdown 渲染保护。
 * remark-gfm 的 transformGfmAutolinkLiterals 在遇到特定字符序列时
 * 会触发 RegExp 构造异常，用 ErrorBoundary 隔离防止整个应用崩溃。
 * （自 InlineAI 迁入，供 AiBlock / PanelChat 共用）
 */
export default class SafeMarkdown extends Component<{ content: string }> {
  state = { error: false, content: this.props.content };

  static getDerivedStateFromError() {
    return { error: true };
  }

  // 流式中间态可能触发渲染异常（如不完整的数学公式），
  // 内容更新时复位 error —— 否则一次中间态错误会让整条消息永远降级。
  static getDerivedStateFromProps(props: { content: string }, state: { content: string }) {
    return props.content !== state.content ? { error: false, content: props.content } : null;
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
