import { isValidElement, type ReactNode, type ReactElement } from 'react';
import { Play } from 'lucide-react';
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

export default function CommandBlock({ children }: { children?: ReactNode }) {
  const runInTerminal = useTerminalStore((s) => s.runInTerminal);
  const code = extractCode(children);
  const isShell = code ? SHELL_LANGS.has(code.lang) : false;
  return (
    <div style={{
      position: 'relative',
      background: 'var(--canvas)',
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
          padding: '3px 10px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--command-block-bg)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {code.lang || 'code'}
          </span>
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
        </div>
      )}
      <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto' }}>
        {children}
      </pre>
    </div>
  );
}
