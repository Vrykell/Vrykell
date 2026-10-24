import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from '@ui/icons';
import { t } from '@i18n';

export type NotificationTone = 'info' | 'success' | 'error' | 'warning';
const icons = { info: Info, success: CheckCircle2, error: AlertCircle, warning: TriangleAlert };

export default function NotificationCard({ tone, message, children, onDismiss, dismissLabel = t('Close notification'), leaving, className = '', ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  tone: NotificationTone; message: ReactNode; children?: ReactNode; onDismiss?: () => void; dismissLabel?: string; leaving?: boolean;
}) {
  const Icon = icons[tone];
  return <div {...props} className={`workspace-floating notification-card ${className}`} data-tone={tone} data-leaving={leaving || undefined}>
    <div className="notification-card-heading"><Icon size={15} aria-hidden="true" /><div className="notification-card-message">{message}</div>
      {onDismiss && <button type="button" className="notification-card-close" aria-label={dismissLabel} data-tip={dismissLabel} onClick={onDismiss}><X size={13} /></button>}
    </div>
    {children && <div className="notification-card-content">{children}</div>}
  </div>;
}
