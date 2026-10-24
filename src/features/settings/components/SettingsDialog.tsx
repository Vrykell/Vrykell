/**
 * SettingsDialog — the centred overlay the model page's editors open in.
 *
 * It mirrors the app's confirmation dialog shell (same overlay, surface and keyboard handling)
 * so a settings editor behaves like every other modal: Escape closes, Tab stays inside, clicking
 * the backdrop dismisses, and the trigger regains focus afterwards.
 */
import { useRef, type ReactNode } from 'react';
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import { ArrowLeft, X } from '@ui/icons';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';

export default function SettingsDialog({ open, title, icon, width = 440, initialFocus, onBack, onClose, children, footer, testId }: {
  open: boolean;
  title: string;
  icon?: ReactNode;
  width?: number;
  /** Selector for the control the dialog should focus first. */
  initialFocus?: string;
  /** Shows a back control before the title (a view switch inside the same dialog). */
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogKeyboard(dialog, open, { onClose, initialFocus });
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9997,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--overlay)', animation: 'overlayIn 0.18s var(--ease)',
      }}
      onClick={onClose}
      data-testid={testId}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className="workspace-floating workspace-floating-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
          animation: 'modalIn 0.22s var(--ease-out)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && (
            <IconButton compact data-testid="dialog-back" aria-label={t('Back')} data-tip={t('Back')} onClick={onBack}>
              <ArrowLeft size={14} />
            </IconButton>
          )}
          {icon}
          <span style={{
            fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)',
            color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <IconButton compact data-testid="dialog-close" aria-label={t('Close')} data-tip={t('Close')} onClick={onClose}>
              <X size={14} />
            </IconButton>
          </span>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}
