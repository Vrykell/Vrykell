import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@i18n';
import { gitComparisonKey, type GitDiff, type GitSelection } from '@core/git';
import { getGitDiff } from '@platform/api/git';
import { useGitReview, useGitSelection } from '../index';
import { useSessionStore, terminalsOf, useWorkspaceNavigation, WorkspaceResourceSwitcher } from '@features/workspace';
import { fileIcon } from '@features/files';
import CodeDiff from '@ui/editor/CodeDiff';
import ErrorBox from '@ui/feedback/ErrorBox';
import { TextButton } from '@ui/actions/TextButton';
import ReloadButton from '@ui/actions/ReloadButton';
import Select from '@ui/fields/Select';
import FolderTabs from '@ui/layout/FolderTabs';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import ResourceContent from '@ui/layout/ResourceContent';
import { useCodeWorkspaceTabs } from '@features/workspace/hooks/useCodeWorkspaceTabs';
import { openWorkspaceFile } from '@features/workspace/services/workspaceActions';
import { IconButton } from '@ui/actions/IconButton';
import { FolderOpen, Plus, iconSizes } from '@ui/icons';
import { newEditorFile } from '@features/editor/services/documentActions';
import './git.css';

export default function GitWorkspace({ children }: { children: ReactNode }) {
  const selection = useGitSelection();
  const tabs = useSessionStore(state => state.tabs);
  const activeId = useSessionStore(state => state.activeId);
  const area = useWorkspaceNavigation(state => state.area);
  const show = !!selection;
  const page = tabs.find(tab => tab.id === activeId && tab.kind === 'git-diff');
  const comparisons = tabs.filter(tab => tab.kind === 'git-diff').flatMap(tab => (tab.comparisons ?? [{ id: tab.id, selection: tab.selection }]).map(item => ({ ...item, pageId: tab.id })));
  // Keep comparison hosts attached when only the navigation order changes.
  const panes = [...comparisons].sort((a, b) => a.id.localeCompare(b.id));
  const pageCount = tabs.filter(tab => tab.kind === 'git-diff').length;
  useEffect(() => { useSessionStore.getState().configureGitDiffTabs(); }, [pageCount]);
  return <>
    <div className="git-terminal-host" style={{ display: show ? 'none' : 'flex' }} inert={show}>{children}</div>
    {panes.map(item => <GitComparison key={item.id} tabId={item.id} selection={item.selection} active={area === 'code' && item.pageId === page?.id && !!selection && gitComparisonKey(item.selection) === gitComparisonKey(selection)} />)}
  </>;
}

function GitComparison({ selection, active, tabId }: { selection: GitSelection; active: boolean; tabId: string }) {
  return <ResourceContent id={`diff:${tabId}`} active={active}>{state => <GitComparisonContent selection={selection} tabId={tabId} active={state.visible} focused={state.focused} />}</ResourceContent>;
}

function GitComparisonContent({ selection, active, focused, tabId }: { selection: GitSelection; active: boolean; focused: boolean; tabId: string }) {
  const codeTabs = useCodeWorkspaceTabs();
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
    <WorkspaceHeader active={active && focused}><FolderTabs items={active ? codeTabs.handles : []} selected={codeTabs.selected ?? ''} grouping={codeTabs.grouping} onRename={codeTabs.onRename} label={t('Open files and comparisons')} listId="code-documents" className="git-review-tabs" headerClassName="git-review-toolbar"
      leading={<WorkspaceResourceSwitcher />}
      onSelect={codeTabs.onSelect} onClose={codeTabs.onClose}
      tabActions={codeTabs.tabActions}
      onMove={codeTabs.onMove} menuItems={[
        ...(codeTabs.tabActions?.(codeTabs.selected ?? '') ?? []),
        { label: backLabel, onClick: back }, { label: t('Side by side'), checked: layout === 'split', onClick: () => setLayout('split') },
        { label: t('Inline comparison'), checked: layout === 'inline', onClick: () => setLayout('inline') },
        { label: t('Previous change'), disabled: !navigate, onClick: () => navigate?.('previous') },
        { label: t('Next change'), disabled: !navigate, onClick: () => navigate?.('next') }, { label: t('Refresh comparison'), onClick: refresh },
      ]} toolbar={<>
        <span className="folder-action-secondary"><Select aria-label={t('Comparison layout')} value={layout} onChange={setLayout} options={[{ value: 'split', label: t('Side by side') }, { value: 'inline', label: t('Inline comparison') }]} /></span>
        <span className="git-diff-navigation folder-action-secondary">{navigation}</span>
        <span className="folder-action-secondary"><ReloadButton compact label={t('Refresh comparison')} onReload={refresh} /></span>
        <IconButton compact className="workspace-open-action" aria-label={t('Open file')} data-tip={t('Open file')} onClick={() => void openWorkspaceFile()}><FolderOpen size={iconSizes.control} /></IconButton>
        <IconButton compact className="workspace-create-action" aria-label={t('New file')} data-tip={t('New file')} onClick={newEditorFile}><Plus size={iconSizes.control} /></IconButton>
      </>} /></WorkspaceHeader>
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
