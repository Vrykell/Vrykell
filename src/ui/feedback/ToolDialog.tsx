import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { IconBtn } from '@ui/actions/UiBtn';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { X, iconSizes } from '@ui/icons';
import { useDialogKeyboard } from '@ui/hooks/useDialogKeyboard';

/**
 * Centered tools share a backdrop, bounded content and focus management.
 * `closePlacement` keeps one close action: the heading icon by default, or a
 * labeled action in the right-aligned footer for informational panels.
 */
export default function ToolDialog({ label, children, onClose, onSubmit, initialFocus, busy = false, width = 440, closePlacement = 'heading' }: {
  label: string; children: ReactNode; onClose: () => void; onSubmit?: () => void;
  initialFocus?: string; busy?: boolean; width?: number; closePlacement?: 'heading' | 'footer';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogKeyboard(ref, true, { onClose, onSubmit, initialFocus, disabled: busy });
  return createPortal(<div className="tool-dialog-overlay" onClick={() => { if (!busy) onClose(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
      className="workspace-floating workspace-floating-dialog tool-dialog" style={{ width }} onClick={event => event.stopPropagation()}>
      <div className="tool-dialog-heading"><strong>{label}</strong>
        {closePlacement === 'heading' && <IconBtn title={t('Close')} disabled={busy} onClick={onClose}><X size={iconSizes.compact} /></IconBtn>}
      </div>
      <div className="tool-dialog-body scroll-region">{children}</div>
      {closePlacement === 'footer' && <footer className="tool-dialog-footer">
        <OutlineButton disabled={busy} onClick={onClose}>{t('Close')}</OutlineButton>
      </footer>}
    </div>
  </div>, document.body);
}
