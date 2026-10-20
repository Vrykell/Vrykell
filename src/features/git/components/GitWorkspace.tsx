import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@i18n';
import { gitComparisonKey, type GitDiff, type GitSelection } from '@core/git';
import { getGitDiff } from '@platform/api/git';
import { useGitReview, useGitSelection } from '../index';
import { useSessionStore, terminalsOf } from '@features/workspace';
import { fileIcon } from '@features/files';
import CodeDiff from '@ui/CodeDiff';
import ErrorBox from '@ui/ErrorBox';
import { TextButton } from '@ui/TextButton';
import ReloadButton from '@ui/ReloadButton';
import { iconSizes } from '@ui/icons';
import Select from '@ui/Select';
import FolderTabs, { type FolderTab } from '@ui/FolderTabs';
import './git.css';

export default function GitWorkspace({ children }: { children: ReactNode }) {
  const selection = useGitSelection();
  const tabs = useSessionStore(state => state.tabs);
  const activeId = useSessionStore(state => state.activeId);
  const show = !!selection;
  const page = tabs.find(tab => tab.id === activeId && tab.kind === 'git-diff');
  const comparisons = tabs.filter(tab => tab.kind === 'git-diff').flatMap(tab => (tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]).map(item => ({ ...item, pageId: tab.id })));
  // Keep comparison hosts attached when only the navigation order changes.
  const panes = [...comparisons].sort((a, b) => a.id.localeCompare(b.id));
  const pageCount = tabs.filter(tab => tab.kind === 'git-diff').length;
  useEffect(() => { useSessionStore.getState().configureGitDiffTabs(); }, [pageCount]);
  const comparisonTabs: FolderTab[] = comparisons.map(comparison => {
    const Icon = fileIcon(comparison.selection.path);
    return { id: comparison.id, label: `${comparison.selection.path.split('/').pop()} · ${t(comparison.selection.scope === 'staged' ? 'Staged changes' : 'File comparison')}`, icon: <Icon size={iconSizes.compact} />, tip: `${comparison.selection.target.cwd}/${comparison.selection.path}`, closeLabel: t('Close comparison {{path}}', { path: comparison.selection.path }) };
  });
  return <>
    <div className="git-terminal-host" style={{ display: show ? 'none' : 'flex' }} inert={show}>{children}</div>
    {panes.map(item => <GitComparison key={item.id} tabId={item.id} selection={item.selection} tabs={comparisonTabs} active={item.pageId === page?.id && !!selection && gitComparisonKey(item.selection) === gitComparisonKey(selection)} />)}
  </>;
}

function GitComparison({ selection, active, tabId, tabs }: { selection: GitSelection; active: boolean; tabId: string; tabs: FolderTab[] }) {
  const revision = useGitReview(state => state.revision);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<'split' | 'inline'>('inline');
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await getGitDiff(selection.target, selection.path, selection.scope);
        if (!disposed) { setDiff(result); setError(''); }
      } catch (reason) { if (!disposed) { setError(String(reason)); setDiff(null); } }
      finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    window.addEventListener('focus', load);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [selection, revision, active]);
  const comparison = {
    staged: [t('HEAD'), t('Staging area'), t('HEAD → staging area')],
    unstaged: [t('Staging area'), t('Working file'), t('Staging area → working file')],
    untracked: [t('Empty file'), t('Working file'), t('Untracked file')],
    conflicts: [t('Current version'), t('Incoming version'), t('Unresolved conflict')],
  }[selection.scope];
  const back = () => {
    const state = useSessionStore.getState();
    const owner = state.tabs.find(tab => tab.id === selection.paneId || terminalsOf(tab).some(terminal => terminal.id === selection.paneId));
    if (owner) state.activate(owner.id); else useGitReview.getState().close();
  };
  const editorOwner = useSessionStore(state => state.tabs.some(tab => tab.id === selection.paneId && tab.kind === 'editor'));
  const refresh = () => useGitReview.getState().refresh();
  const backLabel = t(editorOwner ? 'Back to editor' : 'Back to terminal');
  const Icon = fileIcon(selection.path);
  const toolbar = (navigation?: ReactNode, navigate?: (direction: 'previous' | 'next') => void) => <>
    <FolderTabs items={active ? tabs : []} selected={tabId} label={t('Open comparisons')} listId="git-comparisons" className="git-review-tabs" headerClassName="git-review-toolbar"
      onSelect={id => useSessionStore.getState().activateGitComparison(id)} onClose={id => useSessionStore.getState().closeGitComparison(id)}
      onMove={(...args) => useSessionStore.getState().moveGitComparison(...args)} menuItems={[
        { label: backLabel, onClick: back }, { label: t('Side by side'), checked: layout === 'split', onClick: () => setLayout('split') },
        { label: t('Inline comparison'), checked: layout === 'inline', onClick: () => setLayout('inline') },
        { label: t('Previous change'), disabled: !navigate, onClick: () => navigate?.('previous') },
        { label: t('Next change'), disabled: !navigate, onClick: () => navigate?.('next') }, { label: t('Refresh comparison'), onClick: refresh },
      ]} toolbar={<>
        <span className="folder-action-secondary"><Select aria-label={t('Comparison layout')} value={layout} onChange={setLayout} options={[{ value: 'split', label: t('Side by side') }, { value: 'inline', label: t('Inline comparison') }]} /></span>
        <span className="git-diff-navigation folder-action-secondary">{navigation}</span>
        <span className="folder-action-secondary"><ReloadButton compact label={t('Refresh comparison')} onReload={refresh} /></span>
      </>} />
    <div className="folder-path" data-tip={selection.path}><Icon size={12} /><span>{selection.path}</span><span className="folder-path-scope">{comparison[2]}</span></div>
  </>;
  const notice = selection.scope === 'conflicts' ? <ErrorBox compact tone="info">{t('Resolve conflicts in your editor or terminal; this view compares the two conflict sides.')}</ErrorBox> : null;
  return <section id={`git-comparison-panel-${tabId}`} className="git-review" data-testid={active ? 'git-diff-review' : undefined} role="tabpanel" aria-label={t('File comparison')} style={{ display: active ? 'flex' : 'none' }} inert={!active}>
    {diff?.kind !== 'text' && <>{toolbar()}{notice}</>}
    {error && <ErrorBox title={t('Could not load comparison')} details={error} actions={<TextButton onClick={() => useGitReview.getState().refresh()}>{t('Retry')}</TextButton>} />}
    {!diff && !error && <div className="git-empty" role="status">{t('Loading comparison…')}</div>}
    {diff?.kind === 'binary' && <div className="git-empty">{t('Binary files cannot be shown as a text comparison.')}</div>}
    {diff?.kind === 'tooLarge' && <div className="git-empty">{t('This file is too large to preview. Open it in your editor.')}</div>}
    {diff?.kind === 'text' && <CodeDiff toolbar={toolbar} notice={notice} original={diff.original} modified={diff.modified} path={selection.path} sideBySide={layout === 'split'} onLayoutChange={split => { if (active) setLayout(split ? 'split' : 'inline'); }} originalLabel={comparison[0]} modifiedLabel={comparison[1]} />}
  </section>;
}
