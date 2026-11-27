import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckSmall, Info, TriangleAlert, X, iconSizes } from '@ui/icons';
import { t } from '@i18n';

export type NotificationTone = 'info' | 'success' | 'error' | 'warning';
const icons = { info: Info, success: CheckSmall, error: AlertCircle, warning: TriangleAlert };

export default function NotificationCard({
  tone,
  message,
  children,
  controls,
  onDismiss,
  dismissLabel = t('Close notification'),
  leaving,
  className = '',
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  tone: NotificationTone;
  message: ReactNode;
  children?: ReactNode;
  controls?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  leaving?: boolean;
}) {
  const Icon = icons[tone];
  return (
    <div {...props} className={`workspace-floating notification-card ${className}`} data-tone={tone} data-leaving={leaving || undefined}>
      <div className="notification-card-heading">
        <Icon size={iconSizes.compact} aria-hidden="true" />
        <div className="notification-card-message">{message}</div>
        {controls}
        {onDismiss && (
          <button type="button" className="notification-card-close" aria-label={dismissLabel} data-tip={dismissLabel} onClick={onDismiss}>
            <X size={13} />
          </button>
        )}
      </div>
      {children && <div className="notification-card-content">{children}</div>}
    </div>
  );
}
