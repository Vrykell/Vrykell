import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { IconBtn } from './UiBtn';
import { X, iconSizes } from './icons';
import { useDialogKeyboard } from './useDialogKeyboard';

/** Centered tools share a backdrop, bounded content and focus management. */
export default function ToolDialog({ label, children, onClose, onSubmit, initialFocus, busy = false, width = 440 }: {
  label: string; children: ReactNode; onClose: () => void; onSubmit?: () => void;
  initialFocus?: string; busy?: boolean; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogKeyboard(ref, true, { onClose, onSubmit, initialFocus, disabled: busy });
  return createPortal(<div className="tool-dialog-overlay" onClick={() => { if (!busy) onClose(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
      className="workspace-floating workspace-floating-dialog tool-dialog" style={{ width }} onClick={event => event.stopPropagation()}>
      <div className="tool-dialog-heading"><strong>{label}</strong>
        <IconBtn title={t('Close')} disabled={busy} onClick={onClose}><X size={iconSizes.compact} /></IconBtn>
      </div>
      <div className="tool-dialog-body scroll-region">{children}</div>
    </div>
  </div>, document.body);
}
