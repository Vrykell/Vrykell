import type { CSSProperties, ReactNode } from 'react';
import ErrorDetails from '@ui/ErrorDetails';

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
  detailsTitle = '技术详情',
  compact = false,
  testId,
  style,
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
}) {
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
      </div>
    );
  }

  return (
    <div
      role={palette.role}
      data-testid={testId}
      style={{ ...base, display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}
    >
      {title && <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>}
      {children && <div style={{ lineHeight: 1.6 }}>{children}</div>}
      {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actions}</div>}
      {details && <ErrorDetails title={detailsTitle} text={details} preStyle={{ maxHeight: 160 }} />}
    </div>
  );
}
