import {
  Component, useState,
  type CSSProperties, type ErrorInfo, type MouseEvent, type ReactNode,
} from 'react';
import { Check, ChevronRight, Copy, TriangleAlert } from '@ui/icons';
import { writeClipboardText } from '@platform/clipboard';

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

/** Hover feedback shared by the subtle header buttons. */
const subtleHover = {
  onMouseEnter: (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = 'var(--hover)';
    event.currentTarget.style.color = 'var(--text-secondary)';
  },
  onMouseLeave: (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = 'transparent';
    event.currentTarget.style.color = 'var(--text-muted)';
  },
};

/**
 * Collapsible diagnostic box: a chevron toggle button on the left, an
 * icon-only copy button in the top-right corner, and the raw text below.
 */
function DiagnosticSection({
  title,
  text,
  copyTestId,
  defaultOpen = false,
  preStyle,
}: {
  title: string;
  text: string;
  copyTestId: string;
  defaultOpen?: boolean;
  preStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void writeClipboardText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // The text stays selectable when the clipboard is unavailable.
      });
  };

  return (
    <div style={{
      maxWidth: 520, width: '100%',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 6, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        padding: '2px 3px 2px 2px', background: 'var(--command-block-bg)',
        borderBottom: open ? '1px solid var(--border)' : 'none',
      }}>
        <button
          data-subtle
          type="button"
          aria-expanded={open}
          title={open ? `收起${title}` : `展开${title}`}
          onClick={() => setOpen((value) => !value)}
          {...subtleHover}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: 'var(--font-ui)', fontSize: 'calc(11px * var(--ui-font-scale))',
            padding: '3px 6px', border: 'none', borderRadius: 4,
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <ChevronRight size={11} style={{
            transition: 'transform 0.12s ease',
            transform: open ? 'rotate(90deg)' : 'none',
          }} />
          <span>{title}</span>
        </button>
        <button
          data-subtle
          type="button"
          data-testid={copyTestId}
          title={copied ? '已复制' : `复制${title}`}
          onClick={handleCopy}
          {...subtleHover}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, padding: 0, border: 'none', borderRadius: 4, flexShrink: 0,
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          {copied ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
        </button>
      </div>
      {open && (
        <pre data-selectable style={{
          margin: 0, padding: 12, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          ...preStyle,
        }}>
          {text}
        </pre>
      )}
    </div>
  );
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
      <h2 style={{ margin: 0, fontWeight: 600 }}>页面渲染错误</h2>
      <p data-selectable style={{
        margin: 0, color: 'var(--text-secondary)', fontSize: 'calc(13px * var(--ui-font-scale))',
        maxWidth: 480, textAlign: 'center', lineHeight: 1.6,
      }}>
        {error.message}
      </p>
      <DiagnosticSection
        title="完整错误堆栈"
        text={error.stack ?? '(无堆栈信息)'}
        copyTestId="error-copy-stack"
        defaultOpen
        preStyle={{
          fontSize: 'calc(9px * var(--ui-font-scale))',
          color: 'var(--error)', maxHeight: 120,
        }}
      />
      {componentStack && (
        <DiagnosticSection
          title="组件堆栈"
          text={componentStack.trim()}
          copyTestId="error-copy-component-stack"
          preStyle={{
            fontSize: 'calc(10px * var(--ui-font-scale))',
            color: 'var(--text-muted)', maxHeight: 200,
          }}
        />
      )}
      <button
        onClick={onReset}
        style={{
          marginTop: 8, padding: '8px 24px', fontSize: 'calc(13px * var(--ui-font-scale))',
          background: 'var(--accent)', border: 'none', borderRadius: 6,
          color: 'var(--accent-text)', cursor: 'pointer',
        }}
      >
        重试
      </button>
    </div>
  );
}
