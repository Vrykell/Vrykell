import type { GitOperation, GitSnapshot, GitTarget } from '@core/git';
import { operateGit } from '@platform/api/git';
import { gitTargetKey, useGitOperations } from '../stores/operations';
import { useGitReview } from '../stores/review';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';

export function preferredGitRemote(snapshot: GitSnapshot): string | undefined {
  return snapshot.remotes?.find(name => snapshot.upstream?.startsWith(`${name}/`))
    ?? snapshot.remotes?.find(name => name === 'origin') ?? snapshot.remotes?.[0];
}

export async function runGitOperation(target: GitTarget, operation: GitOperation, options: {
  message?: string; remote?: string; push?: boolean; refresh: () => void; notifyError?: boolean;
}): Promise<void> {
  const key = gitTargetKey(target);
  const store = useGitOperations.getState();
  if (!store.begin(key, operation)) return;
  try {
    await operateGit(target, operation, { message: options.message, remote: options.remote });
    if (operation === 'commit' && useGitOperations.getState().drafts[key] === options.message) store.draft(key, '');
    options.refresh(); useGitReview.getState().refresh();
    if (options.push) { await operateGit(target, 'push', { remote: options.remote }); options.refresh(); }
    useToastStore.getState().addToast(t(operation === 'sync' ? 'Synchronization complete' : operation === 'commit' ? 'Changes committed' : operation === 'pull' ? 'Pull complete' : operation === 'push' ? 'Push complete' : 'Fetch complete'), 'success');
    store.finish(key);
  } catch (reason) {
    store.finish(key, String(reason)); options.refresh();
    if (options.notifyError) useToastStore.getState().addToast(`${t('Repository operation failed')}: ${String(reason)}`, 'error');
  }
}
