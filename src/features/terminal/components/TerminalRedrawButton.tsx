import { t } from '@i18n';
import { isMacOS } from '@platform/runtime';
import { RefreshCw } from '@ui/icons';
import { useReloadFeedback } from '@ui/useReloadFeedback';
import { redrawTerminal } from '../services/terminalRepaint';
import { STATUS_ACTION_ICON_SIZE, StatusActionButton } from './TerminalStatusBar';

/** Rebuild the pane renderer without altering the live process or its buffer. */
export function TerminalRedrawButton({ paneId }: { paneId: string }) {
  const redraw = useReloadFeedback(() => redrawTerminal(paneId));
  return <StatusActionButton
    title={t('Redraw terminal')}
    shortcut={isMacOS ? 'Meta+Shift+R' : 'Control+Shift+R'}
    busy={redraw.busy}
    onClick={() => void redraw.run()}
    label={<RefreshCw size={STATUS_ACTION_ICON_SIZE} className={redraw.busy ? 'reload-spin' : undefined} />}
  />;
}
