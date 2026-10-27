import { Component } from 'react';
import Markdown from '@features/chat/components/Markdown';
import ErrorDetails from '@ui/feedback/ErrorDetails';
import { t } from '@i18n';

/**
 * Rendering guard for a single message's Markdown.
 * The GFM autolink literal transform can throw while building a RegExp for
 * certain character sequences; the ErrorBoundary confines that failure so the
 * whole app does not crash.
 *
 * Fallback: a failed render never swallows the message — the raw text is shown
 * (monospace, selectable) and the error plus a content excerpt are logged to the
 * console for diagnosis.
 */
export default class SafeMarkdown extends Component<{ content: string; paneId?: string | null }, { error: boolean; errorMessage: string; content: string }> {
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

  // Streaming intermediate states can break rendering (e.g. an incomplete math
  // expression); reset the error whenever content changes, otherwise one transient
  // failure would degrade that message permanently.
  static getDerivedStateFromProps(props: { content: string }, state: { content: string }) {
    return props.content !== state.content
      ? { error: false, errorMessage: '', content: props.content }
      : null;
  }

  // While streaming the parent re-renders on every chunk; comparing only content keeps
  // completed messages from re-parsing Markdown + KaTeX on each token (the main source
  // of lag in long conversations).
  shouldComponentUpdate(nextProps: { content: string; paneId?: string | null }) {
    return nextProps.content !== this.props.content || nextProps.paneId !== this.props.paneId;
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorDetails
          title={t('Render failed ({{error}}); showing the source', { error: this.state.errorMessage })}
          text={this.props.content}
          defaultOpen
          preStyle={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'calc(12px * var(--ui-font-scale))',
            color: 'var(--text-secondary)',
          }}
        />
      );
    }
    return <Markdown content={this.props.content} paneId={this.props.paneId} />;
  }
}
