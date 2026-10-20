import { useState } from 'react';
import type { GitReferenceAction, GitSnapshot, GitTarget } from '@core/git';
import { gitTargetKey, useGitOperations } from '../index';
import { remoteGitMenuItems } from '../services/repositoryMenu';
import ContextMenu, { type MenuAnchor } from '@ui/ContextMenu';
import { IconButton } from '@ui/IconButton';
import { Ellipsis, iconSizes } from '@ui/icons';
import { t } from '@i18n';
import { useGitPreferences } from '@config/git';
import GitCommitPrompt from './GitCommitPrompt';
import GitReferenceDialog, { referenceActionLabel } from './GitReferenceDialog';

export default function GitRepositoryActions({ target, snapshot, refresh, showWorktrees }: {
  target: GitTarget | null; snapshot: GitSnapshot | null; refresh: () => void; showWorktrees?: () => void;
}) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [prompt, setPrompt] = useState<GitTarget | null>(null);
  const [reference, setReference] = useState<{ target: GitTarget; snapshot: GitSnapshot; action: GitReferenceAction } | null>(null);
  const view = useGitPreferences(state => state.changesView);
  const key = target ? gitTargetKey(target) : '';
  const busy = useGitOperations(state => state.busy[key]);
  const refItem = (action: GitReferenceAction) => ({ label: referenceActionLabel(action), disabled: !!busy || !!snapshot?.operation
    || (['switchBranch', 'merge', 'rebase'].includes(action) && !!snapshot?.entries.length)
    || (['merge', 'rebase'].includes(action) && (snapshot?.detached || snapshot?.hasHead === false)),
    onClick: () => { if (target && snapshot) setReference({ target: { ...target }, snapshot, action }); } });
  return <>
    <IconButton compact aria-label={t('More source control actions')} data-tip={t('More source control actions')} aria-haspopup="menu" aria-expanded={!!menu}
      disabled={!snapshot || !target} onClick={event => {
        const trigger = event.currentTarget; const rect = trigger.getBoundingClientRect();
        setMenu({ x: rect.left, y: rect.bottom, trigger });
      }}><Ellipsis size={iconSizes.control} /></IconButton>
    {menu && <ContextMenu anchor={menu} label={t('More source control actions')} description={snapshot?.root} onClose={() => setMenu(null)} items={[
      ...remoteGitMenuItems(target, snapshot, !!busy, refresh),
      { label: t('Branches'), submenu: { items: ['switchBranch', 'merge', 'rebase', 'createBranch', 'renameBranch', 'deleteBranch'].map(action => refItem(action as GitReferenceAction)) } },
      { label: t('Tags'), submenu: { items: [refItem('createTag'), refItem('deleteTag')] } },
      { label: t('View changes'), group: 'view', submenu: { items: [
        { label: t('List view'), checked: view === 'list', onClick: () => useGitPreferences.getState().setChangesView('list') },
        { label: t('Tree view'), checked: view === 'tree', onClick: () => useGitPreferences.getState().setChangesView('tree') },
      ] } },
      ...(showWorktrees ? [{ label: t('Linked worktrees'), group: 'view' as const, onClick: showWorktrees }] : []),
      { label: t('AI commit prompt for this workspace…'), group: 'edit', disabled: !target,
        onClick: () => { if (target) setPrompt({ ...target }); } },
    ]} />}
    {prompt && <GitCommitPrompt target={prompt} onClose={() => setPrompt(null)} />}
    {reference && <GitReferenceDialog {...reference} refresh={refresh} onClose={() => setReference(null)} />}
  </>;
}
