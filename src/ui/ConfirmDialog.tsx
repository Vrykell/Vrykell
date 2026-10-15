import { OutlineButton } from '@ui/OutlineButton';
import { useRef } from 'react';
import { useDialogKeyboard } from './useDialogKeyboard';
interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * ConfirmDialog — 通用二次确认弹窗（删除 / 重命名等不可逆或易误触操作）。
 * 确定按钮可按 danger 着色。
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogKeyboard(dialog, open, { onClose: onCancel, onSubmit: onConfirm, initialFocus: '[data-testid="confirm-cancel"]' });
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9997,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--overlay)',
        animation: 'overlayIn 0.18s var(--ease)',
      }}
      onClick={onCancel}
      data-testid="confirm-dialog"
    >
      <div ref={dialog} tabIndex={-1} className="workspace-floating workspace-floating-dialog" role="dialog" aria-modal="true" aria-label={title}
        style={{
          width: 360, maxWidth: 'calc(100vw - 40px)', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 10,
          animation: 'modalIn 0.22s var(--ease-out)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>{title}</div>
        {message && (
          <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)', lineHeight: 1.6, wordBreak: 'break-all' }}>
            {message}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <OutlineButton onClick={onCancel} data-testid="confirm-cancel">{cancelLabel}</OutlineButton>
          <button onClick={onConfirm} data-testid="confirm-ok" style={{
            padding: '5px 16px', fontSize: 'calc(12px * var(--ui-font-scale))', border: 'none',
            borderRadius: 'var(--radius-inner)',
            background: danger ? 'var(--error)' : 'var(--accent)',
            color: danger ? 'var(--error-text)' : 'var(--accent-text)', cursor: 'pointer',
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
