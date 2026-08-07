import { isValidElement, type ReactNode, type ReactElement } from 'react';
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
    <div style={{ position: 'relative' }}>
      <pre style={{ background: '#ffffff0a', borderRadius: 6, padding: 10, overflowX: 'auto' }}>
        {children}
      </pre>
      {isShell && code && (
        <button
          style={{ position: 'absolute', top: 6, right: 6, fontSize: 12 }}
          onClick={() => runInTerminal(code.text.trim())}
        >
          ▶ 在终端运行
        </button>
      )}
    </div>
  );
}
