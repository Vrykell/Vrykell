import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '@i18n';
import { Check, Copy, iconSizes } from '@ui/icons';
import { writeClipboardText } from '@platform/clipboard';

/**
 * CopyButton — icon-only copy control with a checkmark confirmation.
 *
 * Writes `text` through the platform clipboard and keeps the checkmark for 1.5 s
 * (restarted on every click). `label` is the accessible name and the tooltip shown
 * before copying, for example "Copy output"; the confirmed state reads "Copied".
 */
export default function CopyButton({ text, label, testId, className, style, quiet = false, iconSize = iconSizes.copy }: {
  /** Raw text written to the clipboard. */
  text: string;
  /** Accessible name and tooltip for the idle state. */
  label: string;
  testId?: string;
  className?: string;
  style?: CSSProperties;
  /** Rows can keep the existing surface and use only glyph feedback on hover. */
  quiet?: boolean;
  /** Glyph size; the control stays a square target around it. */
  iconSize?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  const name = copied ? t('Copied') : label;

  const handleCopy = () => {
    void writeClipboardText(text)
      .then(() => {
        setCopied(true);
        // Restart the confirmation window so rapid clicks keep the checkmark.
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => {
          copyTimer.current = null;
          setCopied(false);
        }, 1500);
      })
      .catch(() => {
        // The text stays selectable when the clipboard is unavailable.
      });
  };

  return <button
    data-subtle
    type="button"
    data-testid={testId}
    data-tip={name}
    aria-label={name}
    data-copied={copied}
    className={className}
    onClick={handleCopy}
    onMouseEnter={event => { event.currentTarget.style.background = quiet ? 'transparent' : 'var(--hover)'; event.currentTarget.style.color = 'var(--text-secondary)'; }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = 'var(--text-muted)'; }}
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, padding: 0, border: 'none', borderRadius: 4, flexShrink: 0,
      background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
      ...style,
    }}
  >
    {copied ? <Check size={iconSize} style={{ color: 'var(--success)' }} /> : <Copy size={iconSize} />}
  </button>;
}
