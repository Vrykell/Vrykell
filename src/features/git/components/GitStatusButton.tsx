import { useEffect, useMemo, useState } from 'react';
import { useSessionStore, useDockStore, terminalsOf } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { getGitBranches, switchGitBranch } from '@platform/api/git';
import { useGitRepository } from '../hooks/useGitRepository';
import { gitTargetKey, useGitOperations, useGitReview } from '../index';
import { preferredGitRemote, runGitOperation } from '../services/operations';
import { remoteGitMenuItems } from '../services/repositoryMenu';
import { TextButton } from '@ui/actions/TextButton';
import { GitBranch } from '@ui/icons';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';

export default function GitStatusButton({ paneId, branch }: { paneId: string; branch: string }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchOverride, setBranchOverride] = useState('');
  const spec = useSessionStore(state => state.tabs.flatMap(terminalsOf).find(pane => pane.id === paneId));
  const cwd = useSessionStore(state => state.terminalCwds[paneId] ?? spec?.cwd);
  const connectionId = spec?.kind === 'ssh' ? spec.ssh?.connectionId : undefined;
  const target = useMemo(() => cwd && spec && (spec.kind !== 'ssh' || connectionId) ? { cwd, connectionId } : null, [cwd, spec?.kind, connectionId]);
  const repository = useGitRepository(target, !!menu);
  const snapshot = repository.snapshot;
  const resolvedTarget = useMemo(() => target && snapshot ? { ...target, cwd: snapshot.root } : target, [target, snapshot?.root]);
  const key = resolvedTarget ? gitTargetKey(resolvedTarget) : '';
  const busy = useGitOperations(state => state.busy[key]);
  useEffect(() => { setBranchOverride(''); setMenu(null); }, [branch, target]);
  useEffect(() => {
    if (!menu || !resolvedTarget || !snapshot) return;
    let disposed = false;
    setBranches([]);
    void getGitBranches(resolvedTarget).then(names => { if (!disposed) setBranches(names); })
      .catch(() => { if (!disposed) setBranches([]); });
    return () => { disposed = true; };
  }, [!!menu, resolvedTarget, !!snapshot]);
  const refresh = () => { repository.refresh(); useGitReview.getState().refresh(); };
  const openPanel = () => {
    const state = useSessionStore.getState();
    const owner = state.tabs.find(tab => terminalsOf(tab).some(pane => pane.id === paneId));
    if (owner) { state.activate(owner.id); useTerminalStore.getState().setFocusedPane(paneId); }
    useDockStore.getState().openPanel('git');
  };
  const switchBranch = async (name: string) => {
    const store = useGitOperations.getState();
    if (!resolvedTarget || !store.begin(key, 'switchBranch')) return;
    try {
      await switchGitBranch(resolvedTarget, name); setBranchOverride(name); refresh(); store.finish(key);
      useToastStore.getState().addToast(t('Switched to {{branch}}', { branch: name }), 'success');
    } catch (reason) { store.finish(key, String(reason)); useToastStore.getState().addToast(String(reason), 'error'); }
  };
  const displayedBranch = branchOverride || snapshot?.branch || branch;
  return <>
    <TextButton className="terminal-chip terminal-branch" data-testid={`git-status-${paneId}`} aria-label={t('Git status: {{branch}}', { branch: displayedBranch })}
      data-tip={t('Git status: {{branch}}', { branch: displayedBranch })} aria-haspopup="menu" aria-expanded={!!menu} disabled={!target}
      onClick={event => { const trigger = event.currentTarget; const rect = trigger.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.top, trigger, above: trigger }); }}>
      <GitBranch size={12} /><span>{displayedBranch}</span>
    </TextButton>
    {menu && <ContextMenu anchor={menu} label={t('Repository actions')} onClose={() => setMenu(null)}
      description={repository.error ? t('Could not load repository') : snapshot ? `${snapshot.branch}${snapshot.upstream ? ` · ${snapshot.upstream}` : ''}${snapshot.behind ? ` ↓${snapshot.behind}` : ''}${snapshot.ahead ? ` ↑${snapshot.ahead}` : ''}` : repository.loading ? t('Finding repository…') : t('The current directory is not in a repository.')}
      items={[
        { label: t('Open source control'), onClick: openPanel },
        { label: t('Switch branch'), disabled: !!busy || !branches.length || !!snapshot?.entries.length, submenu: { items: branches.map(name => ({ label: name, checked: name === snapshot?.branch, disabled: name === snapshot?.branch, onClick: () => { void switchBranch(name); } })) } },
        { label: t('Sync changes'), disabled: !!busy || !snapshot?.upstream || !!snapshot?.entries.length || snapshot?.detached, onClick: () => {
          if (resolvedTarget && snapshot) void runGitOperation(resolvedTarget, 'sync', { remote: preferredGitRemote(snapshot), refresh, notifyError: true });
        } },
        ...remoteGitMenuItems(resolvedTarget, snapshot, !!busy, refresh, true),
      ]} />}
  </>;
}
