import { useEffect, useState } from 'react';
import { t } from '@i18n';
import type { GitEntry, GitScope, GitTarget } from '@core/git';
import { useGitPreferences } from '@config/git';
import { changeGitFile, operateGit } from '@platform/api/git';
import { useDockStore } from '@features/workspace';
import SidebarToolbar from '@ui/layout/SidebarToolbar';
import ReloadButton from '@ui/actions/ReloadButton';
import { IconButton } from '@ui/actions/IconButton';
import { TextButton } from '@ui/actions/TextButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { GitBranch, ChevronDown, ChevronRight, Minus, Plus, iconSizes } from '@ui/icons';
import { useToastStore } from '@ui/feedback/Toast';
import { useGitReview, useGitSelection, useGitOperations, gitTargetKey } from '../index';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import GitChangeRow from './GitChangeRow';
import GitChangeTree from './GitChangeTree';
import GitWorktrees from './GitWorktrees';
import GitReferenceDialog from './GitReferenceDialog';
import { openGitFile } from '../services/openFile';
import GitCommit from './GitCommit';
import GitRepositoryActions from './GitRepositoryActions';
import { useGitRepository } from '../hooks/useGitRepository';
import { useGitContext } from '../hooks/useGitContext';
import { useGitContextStore } from '../stores/context';
import { groupChanges } from '../model/changes';
import './git.css';

const GROUPS: GitScope[] = ['conflicts', 'staged', 'unstaged', 'untracked'];
const groupLabel = (scope: GitScope) => t({ conflicts: 'Merge conflicts', staged: 'Staged changes', unstaged: 'Unstaged changes', untracked: 'Untracked files' }[scope]);

export default function PanelGit() {
  const context = useGitContext();
  const visible = useDockStore(state => [...state.leftPanels, ...state.rightPanels].includes('git') && !state.collapsedPanels.includes('git'));
  const repository = useGitRepository(context.target, visible);
  const [query, setQuery] = useState('');
  const [worktrees, setWorktrees] = useState(false);
  const [progressAction, setProgressAction] = useState<'abortMerge' | 'abortRebase' | 'continueRebase' | null>(null);
  const [worktreeRevision, setWorktreeRevision] = useState(0);
  const view = useGitPreferences(state => state.changesView);
  const [folded, setFolded] = useState<GitScope[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<{ target: GitTarget; path: string } | null>(null);
  const [resolving, setResolving] = useState<{ target: GitTarget; path: string } | null>(null);
  const selection = useGitSelection();
  const snapshot = repository.snapshot;
  useEffect(() => { if (snapshot) useGitContextStore.getState().canonicalize(context.sourceKey, snapshot.root); }, [snapshot?.root, context.sourceKey]);
  const target = snapshot && context.target ? { ...context.target, cwd: snapshot.root } : context.target;
  const targetKey = target ? gitTargetKey(target) : '';
  const busy = useGitOperations(state => state.busy[targetKey]);
  const groups = groupChanges(snapshot?.entries ?? [], query);
  const refresh = () => { repository.refresh(); useGitReview.getState().refresh(); setWorktreeRevision(value => value + 1); };
  useEffect(() => { setQuery(''); }, [context.target?.cwd, context.target?.connectionId]);
  const change = async (path: string, scope: GitScope) => {
    if (!target || pending || !useGitOperations.getState().begin(targetKey, 'stage')) return;
    setPending(`${scope}:${path}`);
    try {
      await changeGitFile(target, path, scope === 'staged' ? 'unstage' : 'stage');
      refresh();
    } catch (reason) { useToastStore.getState().addToast(`${t('Could not update staging')}: ${String(reason)}`, 'error'); }
    finally { setPending(null); useGitOperations.getState().finish(targetKey); }
  };
  const changeAll = async (scope: GitScope) => {
    if (!target || !useGitOperations.getState().begin(targetKey, 'stage')) return;
    try { await operateGit(target, scope === 'staged' ? 'unstageAll' : 'stageAll'); refresh(); }
    catch (reason) { useToastStore.getState().addToast(String(reason), 'error'); }
    finally { useGitOperations.getState().finish(targetKey); }
  };
  const discard = async () => {
    const requested = discarding;
    setDiscarding(null);
    if (!requested) return;
    const key = gitTargetKey(requested.target);
    if (!useGitOperations.getState().begin(key, 'discard')) return;
    try { await changeGitFile(requested.target, requested.path, 'discard'); refresh(); }
    catch (reason) { useToastStore.getState().addToast(String(reason), 'error'); }
    finally { useGitOperations.getState().finish(key); }
  };
  const resolve = async () => {
    const requested = resolving; setResolving(null);
    if (!requested) return;
    const key = gitTargetKey(requested.target);
    if (!useGitOperations.getState().begin(key, 'resolve')) return;
    try { await changeGitFile(requested.target, requested.path, 'resolve'); refresh(); }
    catch (reason) { useToastStore.getState().addToast(String(reason), 'error'); }
    finally { useGitOperations.getState().finish(key); }
  };
  const renderEntry = (entry: GitEntry, scope: GitScope, depth?: number) => <GitChangeRow key={entry.path} entry={entry} scope={scope} depth={depth}
    active={selection?.target.cwd === target?.cwd && selection?.target.connectionId === target?.connectionId && selection?.path === entry.path && selection.scope === scope}
    busy={!!busy || pending !== null} compare={() => target && useGitReview.getState().open({ target, paneId: context.paneId, path: entry.path, scope })}
    open={() => { if (target) void openGitFile({ target, paneId: context.paneId, path: entry.path, scope }).catch(reason => useToastStore.getState().addToast(String(reason), 'error')); }}
    stage={() => { if (scope === 'conflicts') { if (target) setResolving({ target, path: entry.path }); } else void change(entry.path, scope); }} discard={() => { if (target) setDiscarding({ target, path: entry.path }); }} />;
  return <section className="git-panel" data-testid="git-panel" aria-label={t('Source control')}>
    <SidebarToolbar search={{ value: query, onChange: event => setQuery(event.target.value), 'aria-label': t('Search changed files'), placeholder: t('Search changed files…') }}>
      <ReloadButton compact label={t('Refresh changes')} disabled={!context.target} busy={repository.loading} onReload={refresh} />
      <GitRepositoryActions target={target} snapshot={snapshot} refresh={refresh} showWorktrees={() => setWorktrees(value => !value)} />
    </SidebarToolbar>
    {context.unavailableConnection && <div className="git-empty">{t('Save this SSH connection before browsing changes.')}</div>}
    {!context.target && !context.unavailableConnection && <div className="git-empty">{t('Open a terminal in a project to browse changes.')}</div>}
    {repository.error && <ErrorBox title={t('Could not load repository')} details={repository.error}
      actions={<TextButton onClick={refresh}>{t('Retry')}</TextButton>} />}
    {context.target && !snapshot && !repository.error && <div className="git-empty" role="status">{repository.loading ? t('Finding repository…') : t('The current directory is not in a repository.')}</div>}
    {snapshot && <div className="git-content scroll-region" data-testid="git-content">
      <div className="git-repository" data-tip={`${snapshot.root}\n${snapshot.branch}`}>
        <GitBranch size={iconSizes.compact} /><span>{snapshot.branch}</span><span className="git-count">{snapshot.entries.length}</span>
      </div>
      <div className="git-root" data-tip={snapshot.root}>{snapshot.root}</div>
      {snapshot.operation && <ErrorBox tone="info" title={t(snapshot.operation === 'rebase' ? 'Rebase in progress' : 'Merge in progress')} actions={<>
        {snapshot.operation === 'rebase' && <TextButton disabled={!!busy} onClick={() => setProgressAction('continueRebase')}>{t('Continue rebase')}</TextButton>}
        <TextButton disabled={!!busy} onClick={() => setProgressAction(snapshot.operation === 'rebase' ? 'abortRebase' : 'abortMerge')}>{t('Abort operation')}</TextButton>
      </>} />}
      {worktrees && target ? <><TextButton onClick={() => setWorktrees(false)}>{t('Back to changes')}</TextButton><GitWorktrees target={target} revision={worktreeRevision} onSelect={cwd => {
        useGitContextStore.getState().select({ target: { ...target, cwd }, paneId: context.paneId }); setWorktrees(false);
      }} /></> : <>
      {target && <GitCommit key={targetKey} target={target} snapshot={snapshot} refresh={refresh} />}
      <div className="git-files" aria-busy={repository.loading}>
        {GROUPS.filter(scope => groups[scope].length).map(scope => <section key={scope} aria-label={groupLabel(scope)}>
          <div className="git-group-heading"><button data-subtle className="git-group" aria-expanded={!folded.includes(scope)}
            onClick={() => setFolded(values => values.includes(scope) ? values.filter(value => value !== scope) : [...values, scope])}>
            {folded.includes(scope) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<span>{groupLabel(scope)}</span><span className="git-count">{groups[scope].length}</span>
          </button>{scope !== 'conflicts' && <IconButton compact aria-label={t(scope === 'staged' ? 'Unstage all changes' : 'Stage all changes')} disabled={!!busy || !!groups.conflicts.length} onClick={() => { void changeAll(scope); }}>{scope === 'staged' ? <Minus size={14} /> : <Plus size={14} />}</IconButton>}</div>
          {!folded.includes(scope) && (view === 'tree' ? <GitChangeTree entries={groups[scope]} renderEntry={(entry, depth) => renderEntry(entry, scope, depth)} /> : groups[scope].map(entry => renderEntry(entry, scope)))}
        </section>)}
        {snapshot.entries.length === 0 && <div className="git-empty">{t('Working tree clean')}</div>}
        {snapshot.entries.length > 0 && GROUPS.every(scope => !groups[scope].length) && <div className="git-empty">{t('No matching changed files')}</div>}
      </div>
      </>}
    </div>}
    {progressAction && target && snapshot && <GitReferenceDialog target={target} snapshot={snapshot} action={progressAction} refresh={refresh} onClose={() => setProgressAction(null)} />}
    <ConfirmDialog open={!!discarding} title={t('Discard changes')} danger confirmLabel={t('Discard')} cancelLabel={t('Cancel')}
      message={discarding ? t(discarding.target.connectionId
        ? 'Discard unstaged changes in {{path}}? Staged changes are kept. Untracked remote files are permanently deleted.'
        : 'Discard unstaged changes in {{path}}? Staged changes are kept. Untracked files are moved to the trash.', { path: discarding.path }) : ''}
      onConfirm={() => { void discard(); }} onCancel={() => setDiscarding(null)} />
    <ConfirmDialog open={!!resolving} title={t('Mark as resolved')} confirmLabel={t('Mark as resolved')} cancelLabel={t('Cancel')}
      message={resolving ? t('Stage the resolution of {{path}}? Check that conflict markers have been removed and the file contains the intended result.', { path: resolving.path }) : ''}
      onConfirm={() => { void resolve(); }} onCancel={() => setResolving(null)} />
  </section>;
}
