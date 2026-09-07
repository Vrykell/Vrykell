import { cx } from '@/styles/cx';
import s from './ConfirmDialog.module.css';

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
  if (!open) return null;

  return (
    <div className={s.overlay} onClick={onCancel} data-testid="confirm-dialog">
      <div className={s.panel} onClick={(e) => e.stopPropagation()}>
        <div className={s.title}>{title}</div>
        {message && <div className={s.message}>{message}</div>}
        <div className={s.actions}>
          <button onClick={onCancel} data-testid="confirm-cancel" className={s.cancelBtn}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            data-testid="confirm-ok"
            className={cx(s.confirmBtn, danger ? s.confirmDanger : s.confirmDefault)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
