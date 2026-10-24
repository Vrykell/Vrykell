import { useState, type CSSProperties, type ReactNode } from 'react';
import ErrorDetails from '@ui/feedback/ErrorDetails';
import { IconButton } from '@ui/actions/IconButton';
import { X } from '@ui/icons';
import { t } from '@i18n';
import NotificationPortal from '@ui/feedback/NotificationPortal';
import NotificationCard from '@ui/feedback/NotificationCard';

export type ErrorBoxTone = 'error' | 'info' | 'success';

const TONE: Record<ErrorBoxTone, { background: string; color: string; border: string; role: 'alert' | 'status' }> = {
  error: { background: 'var(--error-bg)', color: 'var(--error-light)', border: 'transparent', role: 'alert' },
  info: { background: 'var(--surface)', color: 'var(--text-secondary)', border: 'var(--border)', role: 'status' },
  success: { background: 'var(--success-bg)', color: 'var(--success)', border: 'transparent', role: 'status' },
};

/**
 * Shared persistent error notifications and inline informational status.
 *
 * Notifications share the transient-message card and retain actions and diagnostics.
 * Informational status may remain inline within its owning surface.
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

  if (tone === 'error') return <NotificationPortal><NotificationCard role="alert" data-testid={testId} tone="error" message={title ?? children} data-error-notification="true"
    dismissLabel={t('Dismiss error')} onDismiss={(dismissible ?? true) ? () => { setDismissed(identity); onDismiss?.(); } : undefined}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !(dismissible ?? true)) return;
      event.preventDefault(); event.stopPropagation();
      const sourceId = event.currentTarget.parentElement?.dataset.notificationSourceId;
      const source = Array.from(document.querySelectorAll<HTMLElement>('[data-notification-source]')).find(element => element.dataset.notificationSource === sourceId);
      source?.closest('[role="dialog"]')?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
      setDismissed(identity); onDismiss?.();
    }}>
    {(title && children || details || actions) ? <>
    {title && children && <div className="error-notification-message">{children}</div>}
    {details && <ErrorDetails title={detailsTitle} text={details} preStyle={{ maxHeight: 160 }} />}
    {actions && <div className="error-box-actions error-notification-actions">{actions}</div>}
    </> : null}
  </NotificationCard></NotificationPortal>;

  if (compact) {
    return (
      <div
        role={palette.role}
        data-testid={testId}
        style={{ ...base, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px' }}
      >
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
        {(actions || close) && <div className="error-box-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}{close}</div>}
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
      {children && <div style={{ lineHeight: 1.6, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</div>}
      {details && <ErrorDetails title={detailsTitle} text={details} preStyle={{ maxHeight: 160 }} />}
      {actions && <div className="error-box-actions" style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>{actions}</div>}
    </div>
  );
}
