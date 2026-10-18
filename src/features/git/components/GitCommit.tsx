import { useEffect, useRef, useState } from 'react';
import type { GitOperation, GitSnapshot, GitTarget } from '@core/git';
import { useGitOperations, gitTargetKey } from '../index';
import { preferredGitRemote, runGitOperation } from '../services/operations';
import { generateCommitMessage } from '../services/commitMessage';
import { TextArea } from '@ui/TextInput';
import { IconButton } from '@ui/IconButton';
import { Check, ChevronDown, Sparkles, RefreshCw, Upload, iconSizes } from '@ui/icons';
import { primaryGitAction } from '../model/primaryAction';
import ErrorBox from '@ui/ErrorBox';
import ContextMenu, { type MenuAnchor } from '@ui/ContextMenu';
import { t } from '@i18n';

export default function GitCommit({ target, snapshot, refresh }: { target: GitTarget; snapshot: GitSnapshot; refresh: () => void }) {
  const key = gitTargetKey(target);
  const message = useGitOperations(state => state.drafts[key] ?? '');
  const busy = useGitOperations(state => state.busy[key]);
  const error = useGitOperations(state => state.errors[key]);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const staged = snapshot.entries.filter(entry => entry.indexStatus !== ' ' && entry.indexStatus !== '?' && entry.indexStatus !== 'U').length;
  const conflicts = snapshot.entries.some(entry => entry.indexStatus === 'U' || entry.worktreeStatus === 'U' || ['AA', 'DD'].includes(entry.indexStatus + entry.worktreeStatus));
  const canCommit = !!message.trim() && staged > 0 && !conflicts && !busy && snapshot.operation !== 'rebase';
  const remotes = snapshot.remotes ?? [];
  const primary = primaryGitAction(snapshot);
  const primaryEnabled = !busy && (primary === 'commit' ? canCommit : primary === 'publish' || primary === 'sync');
  const primaryLabel = primary === 'commit' ? t(busy === 'commit' ? 'Committing…' : 'Commit')
    : primary === 'publish' ? t('Publish branch')
      : primary === 'sync' ? `${t(busy === 'sync' ? 'Synchronizing…' : 'Sync changes')}${snapshot.behind ? ` ↓${snapshot.behind}` : ''}${snapshot.ahead ? ` ↑${snapshot.ahead}` : ''}`
        : t(primary === 'current' ? 'Up to date' : 'Working tree clean');
  const PrimaryIcon = primary === 'sync' ? RefreshCw : primary === 'publish' ? Upload : Check;
  const operate = (operation: GitOperation, push = false) => runGitOperation(target, operation, { message, remote: preferredGitRemote(snapshot), push, refresh });
  const generate = async () => {
    const store = useGitOperations.getState();
    if (!store.begin(key, 'generate')) return;
    const abort = new AbortController(); controller.current = abort;
    try {
      const generated = await generateCommitMessage(target, abort.signal);
      if (useGitOperations.getState().drafts[key] === message || !useGitOperations.getState().drafts[key]) store.draft(key, generated);
      store.finish(key);
    } catch (reason) { store.finish(key, abort.signal.aborted ? undefined : String(reason)); }
    finally { if (controller.current === abort) controller.current = null; }
  };
  return <div className="git-commit-area" data-testid="git-commit-area">
    <div className="git-message-field">
      <TextArea rows={3} aria-label={t('Commit message')} placeholder={t('Message (Ctrl/Cmd+Enter to commit)')} value={message}
        onChange={event => useGitOperations.getState().draft(key, event.target.value)}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && canCommit) { event.preventDefault(); event.stopPropagation(); void operate('commit'); } }} />
      <IconButton compact aria-label={t('Generate commit message')} data-tip={t('Summarize staged changes with the configured AI model')}
        disabled={!!busy || !staged || conflicts} onClick={() => { void generate(); }}><Sparkles size={iconSizes.compact} /></IconButton>
    </div>
    <div className="git-commit-buttons" role="group" aria-label={t('Repository actions')}>
      <button className="primary-button git-commit-primary" disabled={!primaryEnabled} onClick={() => { void operate(primary === 'sync' ? 'sync' : primary === 'publish' ? 'push' : 'commit'); }}><PrimaryIcon size={iconSizes.compact} />{primaryLabel}</button>
      <IconButton className="git-commit-options" aria-label={t('Commit actions')} aria-haspopup="menu" aria-expanded={!!menu} disabled={!!busy}
        onClick={event => { const trigger = event.currentTarget; const rect = trigger.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom, trigger }); }}><ChevronDown size={iconSizes.compact} /></IconButton>
    </div>
    {!staged && primary === 'commit' && <span className="git-commit-hint">{t('Stage changes to include them in your commit.')}</span>}
    {busy && <span className="git-commit-hint" role="status">{t(busy === 'generate' ? 'Generating commit message…' : 'Repository operation in progress…')}</span>}
    {snapshot.upstream && <span className="git-commit-hint" data-tip={snapshot.upstream}>{snapshot.upstream}</span>}
    {!remotes.length && <span className="git-commit-hint">{t('No remote configured')}</span>}
    {error && <ErrorBox title={t('Repository operation failed')} details={error} onDismiss={() => useGitOperations.getState().finish(key)} />}
    {menu && <ContextMenu anchor={menu} label={t('Commit actions')} onClose={() => setMenu(null)} items={[
      { label: t('Commit'), disabled: !canCommit, onClick: () => { void operate('commit'); } },
      { label: t('Commit and push'), disabled: !canCommit || !remotes.length || snapshot.detached, onClick: () => { void operate('commit', true); } },
      { label: t('Sync changes'), disabled: !!busy || snapshot.entries.length > 0 || !snapshot.upstream || snapshot.detached, onClick: () => { void operate('sync'); } },
    ]} />}
  </div>;
}
