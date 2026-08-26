import { isValidElement, useState, type ReactNode, type ReactElement } from 'react';
import { Play, Copy, Check } from 'lucide-react';
import { useTerminalStore } from '../stores/terminal';

const SHELL_LANGS = new Set(['bash', 'sh', 'zsh', 'shell']);

function extractCode(children: ReactNode): { lang: string; text: string } | null {
  // ReactMarkdown 的 pre 唯一子节点是 <code className="language-x">text</code>
  if (!isValidElement(children)) return null;
  const code = children as ReactElement<{ className?: string; children?: ReactNode }>;
  const lang = (code.props.className ?? '').replace('language-', '');
  const text = typeof code.props.children === 'string' ? code.props.children : '';
  return { lang, text };
}

/** 复制文本到剪贴板（navigator.clipboard 优先，WKWebView 受限时回退 execCommand）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function CommandBlock({ children }: { children?: ReactNode }) {
  const runInTerminal = useTerminalStore((s) => s.runInTerminal);
  const code = extractCode(children);
  const isShell = code ? SHELL_LANGS.has(code.lang) : false;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!code) return;
    if (await copyText(code.text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div style={{
      position: 'relative',
      background: 'var(--block)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-inner)',
      margin: '0.45em 0',
      overflow: 'hidden',
    }}>
      {code && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
          padding: '3px 10px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--command-block-bg)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {code.lang || 'code'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {isShell && (
              <button
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11,
                  padding: '2px 10px',
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-blue-dim)',
                  color: 'var(--accent)',
                }}
                onClick={() => runInTerminal(code.text.trim())}
              >
                <Play size={10} /> 在终端运行
              </button>
            )}
            {/* 复制按钮固定在右上角（最右侧） */}
            <button
              data-testid="code-copy-btn"
              title={copied ? '已复制' : '复制代码'}
              onClick={() => void copy()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, padding: '2px 8px', border: 'none',
                background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              {copied ? <Check size={10} style={{ color: 'var(--success)' }} /> : <Copy size={10} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      )}
      <pre style={{ margin: 0, padding: '10px 12px', whiteSpace: 'pre', overflowX: 'auto' }}>
        {children}
      </pre>
    </div>
  );
}
