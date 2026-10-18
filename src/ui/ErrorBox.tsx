import { useState, type CSSProperties, type ReactNode } from 'react';
import ErrorDetails from '@ui/ErrorDetails';
import { IconButton } from './IconButton';
import { X } from './icons';
import { t } from '@i18n';

export type ErrorBoxTone = 'error' | 'info' | 'success';

const TONE: Record<ErrorBoxTone, { background: string; color: string; border: string; role: 'alert' | 'status' }> = {
  error: { background: 'var(--error-bg)', color: 'var(--error-light)', border: 'transparent', role: 'alert' },
  info: { background: 'var(--surface)', color: 'var(--text-secondary)', border: 'var(--border)', role: 'status' },
  success: { background: 'var(--success-bg)', color: 'var(--success)', border: 'transparent', role: 'status' },
};

/**
 * ErrorBox — inline error / status box shared by panel surfaces.
 *
 * Tone-colored container with an optional bold title, message, action buttons
 * and a collapsible raw-text section (chevron toggle + copy) for diagnostics.
 * `compact` renders a single row for tight spots (message + inline actions).
 */
export default function ErrorBox({
  tone = 'error',
  title,
  children,
  actions,
  details,
  detailsTitle = t('Technical details'),
  compact = false,
  testId,
  style,
  onDismiss,
  dismissible,
}: {
  tone?: ErrorBoxTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  details?: string;
  detailsTitle?: string;
  compact?: boolean;
  testId?: string;
  style?: CSSProperties;
  onDismiss?: () => void;
  dismissible?: boolean;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const identity = JSON.stringify([tone, typeof title === 'string' ? title : '', typeof children === 'string' ? children : '', details]);
  const close = (dismissible ?? tone === 'error') ? <IconButton compact aria-label={t('Dismiss error')} data-tip={t('Dismiss error')}
    onClick={() => { setDismissed(identity); onDismiss?.(); }}><X size={14} /></IconButton> : null;
  if (dismissed === identity) return null;
  const palette = TONE[tone];
  const base: CSSProperties = {
    background: palette.background,
    color: palette.color,
    border: `1px solid ${palette.border}`,
    borderRadius: 'var(--radius-inner)',
    fontSize: 'var(--fs-label)',
    ...style,
  };

  if (compact) {
    return (
      <div
        role={palette.role}
        data-testid={testId}
        style={{ ...base, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
        {actions}
        {close}
      </div>
    );
  }

  return (
    <div
      role={palette.role}
      data-testid={testId}
      style={{ ...base, display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}
    >
      {(title || close) && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>{title}</div>{close}
      </div>}
      {children && <div style={{ lineHeight: 1.6 }}>{children}</div>}
      {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actions}</div>}
      {details && <ErrorDetails title={detailsTitle} text={details} preStyle={{ maxHeight: 160 }} />}
    </div>
  );
}
