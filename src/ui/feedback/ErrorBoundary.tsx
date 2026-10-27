import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from '@ui/icons';
import ErrorDetails from '@ui/feedback/ErrorDetails';
import { t } from '@i18n';

interface Props {
  children: ReactNode;
  /** Custom fallback UI; the default is used when omitted. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Last line of defence for render crashes: catches unhandled render errors in the subtree and
 * shows a fallback instead of a blank page. Event handlers, async code, SSR and errors thrown by
 * the boundary itself are not caught.
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
      <h2 style={{ margin: 0, fontWeight: 'var(--fw-semibold)' }}>{t('Page render error')}</h2>
      <p data-selectable style={{
        margin: 0, color: 'var(--text-secondary)', fontSize: 'calc(13px * var(--ui-font-scale))',
        maxWidth: 480, textAlign: 'center', lineHeight: 1.6,
      }}>
        {error.message}
      </p>
      <ErrorDetails
        title={t('Full error stack')}
        text={error.stack ?? t('(no stack trace)')}
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
          title={t('Component stack')}
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
