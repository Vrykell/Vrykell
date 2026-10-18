import type { GitOperation, GitSnapshot, GitTarget } from '@core/git';
import type { ContextMenuItem } from '@ui/ContextMenu';
import { groupChanges } from '../model/changes';
import { preferredGitRemote, runGitOperation } from './operations';
import { t } from '@i18n';

export function remoteGitMenuItems(target: GitTarget | null, snapshot: GitSnapshot | null, busy: boolean, refresh: () => void, notifyError = false): ContextMenuItem[] {
  const remotes = snapshot?.remotes ?? [];
  const conflicts = !!snapshot && groupChanges(snapshot.entries, '').conflicts.length > 0;
  const action = (operation: GitOperation, label: string): ContextMenuItem => {
    const disabled = busy || !target || !remotes.length || (operation !== 'fetch' && !!snapshot?.detached) || (operation === 'pull' && conflicts);
    const run = (remote?: string) => { if (target) void runGitOperation(target, operation, { remote, refresh, notifyError }); };
    return remotes.length > 1
      ? { label, disabled, submenu: { items: remotes.map(remote => ({ label: remote, onClick: () => run(remote) })) } }
      : { label, disabled, onClick: () => run(snapshot ? preferredGitRemote(snapshot) : undefined) };
  };
  return [
    action('fetch', t('Fetch')),
    action('pull', snapshot?.behind ? t('Pull ({{count}} incoming)', { count: snapshot.behind }) : t('Pull')),
    action('push', snapshot?.ahead ? t('Push ({{count}} outgoing)', { count: snapshot.ahead }) : t('Push')),
  ];
}
