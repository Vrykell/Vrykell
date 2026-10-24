import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from '@ui/icons';
import ErrorDetails from '@ui/feedback/ErrorDetails';
import { t } from '@i18n';

interface Props {
  children: ReactNode;
  /** 自定义降级 UI，不传则用默认 */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary — React 渲染崩溃最后防线。
 *
 * 捕获子树中所有未处理的渲染异常，显示降级 UI 而非白屏。
 * 不会捕获：事件处理器、异步代码、SSR、ErrorBoundary 自身的错误。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <DefaultFallback
          error={this.state.error}
          componentStack={this.state.errorInfo?.componentStack ?? undefined}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, componentStack, onReset }: {
  error: Error;
  componentStack?: string;
  onReset: () => void;
}) {
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--canvas)', color: 'var(--text-primary)',
      fontFamily: 'var(--font-ui)', padding: 40, gap: 16,
    }}>
      <div style={{ opacity: 0.3 }}><TriangleAlert size={48} /></div>
      <h2 style={{ margin: 0, fontWeight: 'var(--fw-semibold)' }}>页面渲染错误</h2>
      <p data-selectable style={{
        margin: 0, color: 'var(--text-secondary)', fontSize: 'calc(13px * var(--ui-font-scale))',
        maxWidth: 480, textAlign: 'center', lineHeight: 1.6,
      }}>
        {error.message}
      </p>
      <ErrorDetails
        title="完整错误堆栈"
        text={error.stack ?? '(无堆栈信息)'}
        copyTestId="error-copy-stack"
        defaultOpen
        style={{ maxWidth: 520, width: '100%' }}
        preStyle={{
          fontSize: 'calc(9px * var(--ui-font-scale))',
          color: 'var(--error)', maxHeight: 120,
        }}
      />
      {componentStack && (
        <ErrorDetails
          title="组件堆栈"
          text={componentStack.trim()}
          copyTestId="error-copy-component-stack"
          style={{ maxWidth: 520, width: '100%' }}
          preStyle={{
            fontSize: 'calc(10px * var(--ui-font-scale))',
            color: 'var(--text-muted)', maxHeight: 200,
          }}
        />
      )}
      <button
        className="primary-button"
        onClick={onReset}
        style={{
          marginTop: 8, padding: '8px 24px', fontSize: 'calc(13px * var(--ui-font-scale))',
          background: 'var(--primary-button-bg)', border: 'none', borderRadius: 6,
          color: 'var(--primary-button-text)', cursor: 'pointer',
        }}
      >
        {t('Retry')}
      </button>
    </div>
  );
}
