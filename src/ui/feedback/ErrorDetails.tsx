import { useState, type CSSProperties } from 'react';
import { t } from '@i18n';
import { ChevronRight } from '@ui/icons';
import CopyButton from '@ui/actions/CopyButton';

/**
 * ErrorDetails — collapsible diagnostic text box.
 *
 * Diagnostics stay selectable. Compact disclosures show the copy control
 * inside the expanded output. Framed disclosures keep it in the header.
 */
export default function ErrorDetails({
  title,
  text,
  defaultOpen = false,
  copyTestId,
  testId,
  preStyle,
  style,
  quiet = false,
  expanded,
  contentId,
}: {
  title: string;
  text: string;
  defaultOpen?: boolean;
  copyTestId?: string;
  testId?: string;
  preStyle?: CSSProperties;
  style?: CSSProperties;
  quiet?: boolean;
  expanded?: boolean;
  contentId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const copy = (
    <CopyButton
      text={text}
      label={t('Copy {{name}}', { name: title })}
      testId={copyTestId}
      quiet={quiet}
      className={quiet ? 'error-details-copy' : undefined}
    />
  );
  const output = (
    <pre
      data-selectable
      style={{
        margin: 0,
        padding: quiet ? 10 : 12,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...(quiet && { color: 'var(--text-secondary)' }),
        ...preStyle,
      }}>
      {text}
    </pre>
  );
  const content = quiet ? (
    <div className="error-details-output">
      {output}
      {copy}
    </div>
  ) : (
    output
  );
  if (expanded !== undefined)
    return (
      <div id={contentId} hidden={!expanded}>
        {expanded && content}
      </div>
    );

  return (
    <div
      data-testid={testId}
      className={quiet ? 'error-details-quiet' : undefined}
      style={{
        background: quiet ? 'transparent' : 'var(--surface)',
        border: quiet ? 'none' : '1px solid var(--border)',
        borderRadius: 'var(--radius-inner)',
        overflow: 'hidden',
        ...style,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: quiet ? 0 : '2px 3px 2px 2px',
          background: quiet ? 'transparent' : 'var(--field-bg)',
          borderBottom: open && !quiet ? '1px solid var(--border)' : 'none',
        }}>
        <button
          data-subtle
          className="error-details-toggle"
          type="button"
          aria-expanded={open}
          data-tip={t(open ? 'Collapse {{name}}' : 'Expand {{name}}', { name: title })}
          onClick={() => setOpen(!open)}>
          <ChevronRight
            size={quiet ? 16 : 11}
            style={{
              transition: 'transform 0.12s ease',
              transform: open ? 'rotate(90deg)' : 'none',
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </button>
        {!quiet && copy}
      </div>
      {open && content}
    </div>
  );
}
