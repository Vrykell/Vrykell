import { t } from '@i18n';
import { onForwardedLaunch, takeForwardedLaunchDirectories } from '@platform/contextMenu';
import { useWorkspaceStore } from '../stores/workspace';

let listening = false;

/** Open one terminal tab in this window for every directory waiting in the forwarded queue. */
async function openForwardedDirectories(): Promise<void> {
  for (const cwd of await takeForwardedLaunchDirectories()) {
    useWorkspaceStore.getState().addTab({ cwd });
  }
}

/**
 * Handle a launch that another process redirected to this already-running window: later
 * directories arrive through the event, and the drain also opens what was forwarded before this
 * window could listen. The queue is drained by whoever gets there first, so the two paths never
 * open one directory twice.
 */
export async function initForwardedLaunch(
  onError: (message: string, error: unknown) => void,
): Promise<void> {
  const report = (error: unknown) => onError(t('Could not open the requested directory'), error);
  if (!listening) {
    listening = true;
    await onForwardedLaunch(() => {
      void openForwardedDirectories().catch(report);
    }).catch((error: unknown) => {
      listening = false;
      report(error);
    });
  }
  await openForwardedDirectories().catch(report);
}
