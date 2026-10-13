import { useState, type CSSProperties, type MouseEvent } from 'react';
import { t } from '@i18n';
import { ChevronRight } from '@ui/icons';
import CopyButton from '@ui/CopyButton';

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
 * ErrorDetails — collapsible diagnostic text box.
 *
 * Header: a chevron toggle button with the title on the left, an icon-only
 * copy button in the top-right corner that turns into a checkmark after a
 * successful copy. Body: the raw text, always selectable.
 */
export default function ErrorDetails({
  title,
  text,
  defaultOpen = false,
  copyTestId,
  testId,
  preStyle,
  style,
}: {
  title: string;
  text: string;
  defaultOpen?: boolean;
  copyTestId?: string;
  testId?: string;
  preStyle?: CSSProperties;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div data-testid={testId} style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 6, overflow: 'hidden',
      ...style,
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
          data-tip={open ? `收起${title}` : `展开${title}`}
          onClick={() => setOpen((value) => !value)}
          {...subtleHover}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0,
            fontFamily: 'var(--font-ui)', fontSize: 'calc(11px * var(--ui-font-scale))',
            padding: '3px 6px', border: 'none', borderRadius: 4,
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <ChevronRight size={11} style={{
            transition: 'transform 0.12s ease',
            transform: open ? 'rotate(90deg)' : 'none',
          }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </button>
        <CopyButton text={text} label={t('Copy {{name}}', { name: title })} testId={copyTestId} />
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
