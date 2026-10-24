import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { IconButton } from '@ui/actions/IconButton';
import { t } from '@i18n';
import { formatCommandDuration } from '../model/commandDuration';

/** Icon size used by every terminal status action button. */
export const STATUS_ACTION_ICON_SIZE = 16;

/**
 * TerminalStatusBar — the single status row shared by a running command block and the
 * fullscreen TUI banner. It renders cwd + elapsed duration + running dot + optional label,
 * git branch and agent on the left and the action buttons on the right, reusing the
 * command-block-info styling so the two surfaces cannot drift apart. Actions stay hidden
 * until hover/focus unless `alwaysShowActions` opts the bar into a persistent toolbar.
 */
export function TerminalStatusBar({ cwd, startedAt, label, gitBranch, agent, actions, alwaysShowActions, style }: {
  cwd?: string;
  startedAt?: number | null;
  label?: ReactNode;
  gitBranch?: string;
  agent?: ReactNode;
  actions?: ReactNode;
  alwaysShowActions?: boolean;
  style?: CSSProperties;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const elapsed = startedAt != null ? formatCommandDuration(now - startedAt) : '';

  return (
    <div data-selectable className="command-block-info" style={style} data-bar-actions={alwaysShowActions ? 'always' : undefined}>
      {cwd && <span className="command-block-cwd" data-tip={cwd}>{cwd}</span>}
      {elapsed && <span className="command-status-duration">({elapsed})</span>}
      <span className="command-block-running" aria-label={t('Running')} />
      {label && <span className="command-block-label">{label}</span>}
      {gitBranch && <span className="command-block-branch">{gitBranch}</span>}
      {agent}
      {actions && <span className="command-block-actions">{actions}</span>}
    </div>
  );
}

/** Compact icon action button shared by both terminal status bars. */
export function StatusActionButton({ title, shortcut, onClick, label, busy = false, preserveFocus = false }: {
  title: string;
  shortcut?: string;
  onClick: (event: React.MouseEvent) => void;
  label: ReactNode;
  busy?: boolean;
  preserveFocus?: boolean;
}) {
  return <IconButton compact data-subtle data-tip={title} data-tip-shortcut={shortcut} aria-label={title}
    disabled={busy} aria-busy={busy}
    onMouseDown={preserveFocus ? event => event.preventDefault() : undefined}
    onClick={event => { event.stopPropagation(); onClick(event); }}>{label}</IconButton>;
}
