import React from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

/** Pure presentational confirm dialog — all strings come from parent via i18n. */
export const ConfirmDialog: React.FC<Props> = ({
  open, title, message, confirmLabel, cancelLabel,
  onConfirm, onCancel, danger,
}) => {
  if (!open) return null;

  const lines = message.split('\n');

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-box" onClick={e => e.stopPropagation()}>
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-message">
          {lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-cancel" onClick={onCancel} autoFocus>
            {cancelLabel}
          </button>
          <button
            className={`dialog-btn ${danger ? 'dialog-btn-danger' : 'dialog-btn-confirm'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
