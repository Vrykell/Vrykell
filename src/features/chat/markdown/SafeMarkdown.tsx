import { Component } from 'react';
import Markdown from '@/features/chat/markdown/Markdown';

export default class SafeMarkdown extends Component<
  { content: string },
  { error: boolean; errorMessage: string; content: string }
> {
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
      '\n内容摘要:',
      JSON.stringify(this.props.content.slice(0, 300)),
      '\n组件栈:',
      info.componentStack ?? '(无)',
    );
  }

  static getDerivedStateFromProps(props: { content: string }, state: { content: string }) {
    return props.content !== state.content
      ? { error: false, errorMessage: '', content: props.content }
      : null;
  }

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
