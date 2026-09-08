import { TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import s from './ErrorBoundary.module.css';

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
      return (
        this.props.fallback ?? (
          <DefaultFallback
            error={this.state.error}
            componentStack={this.state.errorInfo?.componentStack ?? undefined}
            onReset={this.handleReset}
          />
        )
      );
    }
    return this.props.children;
  }
}

function DefaultFallback({
  error,
  componentStack,
  onReset,
}: {
  error: Error;
  componentStack?: string;
  onReset: () => void;
}) {
  return (
    <div className={s.fallback}>
      <div className={s.icon}>
        <TriangleAlert size={48} />
      </div>
      <h2 className={s.heading}>页面渲染错误</h2>
      <p className={s.errorText}>{error.message}</p>
      <details open className={s.details}>
        <summary className={s.summary}>完整错误堆栈</summary>
        <pre className={s.pre}>{error.stack}</pre>
      </details>
      {componentStack && (
        <details className={s.details}>
          <summary className={s.summary}>组件堆栈</summary>
          <pre className={s.preMuted}>{componentStack.trim()}</pre>
        </details>
      )}
      <button onClick={onReset} className={s.retryBtn}>
        重试
      </button>
    </div>
  );
}
