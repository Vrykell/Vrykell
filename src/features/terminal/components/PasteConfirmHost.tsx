import ConfirmDialog from '@ui/ConfirmDialog';
import { t } from '@i18n';
import { usePasteConfirm } from '@features/terminal/hooks/usePasteConfirm';

/**
 * Host for the paste confirmation: the clipboard service asks the question, this surface answers
 * it. Mounted once at the application overlay layer so every scene (classic, running block, SSH)
 * shares one dialog.
 */
export default function PasteConfirmHost() {
  const { request, confirm, cancel } = usePasteConfirm();
  if (!request) return null;
  const message = t(
    request.reason === 'lines' ? 'terminal.clipboard.confirmPasteLines' : 'terminal.clipboard.confirmPasteSize',
    { lines: request.lines, chars: request.chars },
  );
  return (
    <ConfirmDialog
      open
      title={t('terminal.clipboard.confirmPasteTitle')}
      message={message}
      confirmLabel={t('terminal.menu.paste')}
      cancelLabel={t('Cancel')}
      onConfirm={confirm}
      onCancel={cancel}
    />
  );
}
