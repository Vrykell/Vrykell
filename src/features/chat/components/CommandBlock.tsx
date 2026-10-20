import { isValidElement, useState, type ReactNode, type ReactElement } from 'react';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { TextButton } from '@ui/TextButton';
import { Play, Copy, Check, iconSizes } from '@ui/icons';
import { useTerminalStore } from '@features/terminal';

const SHELL_LANGS = new Set(['bash', 'sh', 'zsh', 'shell']);

function extractCode(children: ReactNode): { lang: string; text: string } | null {
  // Fenced content arrives as a single code element with an optional language class.
  if (!isValidElement(children)) return null;
  const code = children as ReactElement<{ className?: string; children?: ReactNode }>;
  const lang = (code.props.className ?? '').replace('language-', '');
  const text = typeof code.props.children === 'string' ? code.props.children : '';
  return { lang, text };
}

/** Copy literal text, with a fallback for restricted clipboard access. */
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

export default function CommandBlock({ children, paneId }: { children?: ReactNode; paneId?: string | null }) {
  const runInTerminal = useTerminalStore((s) => s.runInTerminal);
  const sessionId = useTerminalStore(state => paneId ? state.sessions[paneId] : undefined);
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
    <div className="md-code-block">
      {code && (
        <div className="md-code-block-header">
          <span className="md-code-block-language">
            {code.lang || 'code'}
          </span>
          <div className="md-code-block-actions">
            {isShell && paneId !== null && (
              <TextButton className="primary-button md-code-block-action"
                disabled={paneId !== undefined && !sessionId}
                onClick={() => {
                  const text = code.text.trim();
                  void runInTerminal(text, paneId ?? undefined).catch(() => {
                    useToastStore.getState().addToast(t('Could not run the command in the selected terminal'), 'error');
                  });
                  if (/[\r\n]/.test(text)) useToastStore.getState().addToast(t('Script added to command input. Press Enter to run.'), 'info');
                }}
              >
                <Play size={10} /> {t('Run in terminal')}
              </TextButton>
            )}
            <TextButton className="md-code-block-action"
              data-testid="code-copy-btn"
              data-tip={t(copied ? 'Copied' : 'Copy code')}
              onClick={() => void copy()}
            >
              {copied ? <Check size={iconSizes.copy} style={{ color: 'var(--success)' }} /> : <Copy size={iconSizes.copy} />}
              {t(copied ? 'Copied' : 'Copy')}
            </TextButton>
          </div>
        </div>
      )}
      <pre>
        {children}
      </pre>
    </div>
  );
}
