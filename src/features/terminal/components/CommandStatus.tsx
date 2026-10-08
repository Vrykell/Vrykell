import { t } from '@i18n';
import { Check, X, Zap } from '@ui/icons';
import { fmtDuration } from '@ui/UiBtn';

/** Flat command metadata shares configurable status colors and typography. */
export default function CommandStatus({ exitCode, duration, agent = false }: { exitCode: number | null; duration: number | null; agent?: boolean }) {
  return <span className="command-status">
    {duration !== null && <span className="command-status-duration">({fmtDuration(duration)})</span>}
    {agent && <Zap size={14} className="command-status-agent" aria-label={t('AI execution')} />}
    {exitCode !== null && <span data-testid="exit-code" className="command-status-code"
      data-failed={exitCode !== 0} aria-label={t('Exit code {{code}}', { code: exitCode })}>
      {exitCode === 0 ? <Check size={14} /> : <X size={14} />}<span>{exitCode}</span>
    </span>}
  </span>;
}
