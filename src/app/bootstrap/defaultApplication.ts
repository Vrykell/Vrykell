import { setDefaultStream, useChatStore } from '@features/chat';
import { refreshAiConfig, refreshToolPolicy } from '@features/agent';
import { agentStream } from '@features/agent/services/agentStream';
import { initAutoTitle } from '@features/agent/services/title';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useHistoryStore } from '@features/terminal/stores/history';
import { initForwardedLaunch, restoreWorkspace } from '@features/workspace';
import { createApplicationBootstrap } from '@app/bootstrap/applicationBootstrap';
import { useToastStore } from '@ui/feedback/Toast';
import { getShellLaunchDirectory } from '@platform/contextMenu';
import { ptyCloseAll } from '@platform/pty';
import { t } from '@i18n';
import { restoreWorkbench } from '@features/workspace/services/workbench';
import { useStartupSettings } from '@features/settings/stores/startup';
import { reportWorkbenchFailure } from '@features/workspace/stores/workbenchFeedback';
import { createSharedStartupTask } from './sharedStartupTask';

/** Page-scope sweep: a strict-mode replay must share one close call, not race a second one. */
let staleSessionsClosed: Promise<void> | null = null;
let restoreTask: ReturnType<typeof createSharedStartupTask> | undefined;

function closeStalePtySessions(): Promise<void> {
  staleSessionsClosed ??= ptyCloseAll()
    .then(() => undefined)
    .catch(error => {
      console.warn('[terminal] failed to close stale PTY sessions:', error);
    });
  return staleSessionsClosed;
}

/** Application startup orchestration stays outside business components. */
export function startDefaultApplication(): () => void {
  const reportFailure = (message: string, error: unknown) => {
    console.warn(`[application] ${message}:`, error);
    useToastStore.getState().addToast(`${message}：${String((error as Error)?.message ?? error)}`, 'error');
  };
  return createApplicationBootstrap({
    configureAgentStream: () => {
      setDefaultStream(agentStream);
      void useChatStore.getState().loadConversations();
    },
    refreshAiConfig,
    refreshToolPolicy,
    subscribeAutoTitle: initAutoTitle,
    restoreWorkspace: () => {
      restoreTask ??= createSharedStartupTask(async () => {
        // A page reload keeps the backend and its PTY sessions alive; terminate the
        // previous page's shells before the restored tabs start their own.
        await closeStalePtySessions();
        const launchDirectory = await getShellLaunchDirectory().catch(error => {
          reportFailure(t('Could not open the requested directory'), error);
          return null;
        });
        await restoreWorkspace({ onError: reportFailure, launchDirectory });
        const mode = launchDirectory ? 'default' : useStartupSettings.getState().mode;
        const restore = () => restoreWorkbench(mode, error => reportWorkbenchFailure(error, () => { void restore(); }));
        await restore();
        // Subscribe after the explicit launch is placed so queued redirects get their own tab.
        await initForwardedLaunch(reportFailure);
      });
      return restoreTask();
    },
    loadWorkspaceDirs: () => useWorkspaceDirsStore.getState().load(),
    hydrateHistory: () => useHistoryStore.getState().hydrate(),
  }, {
    onError: (taskName, error) => reportFailure(t('Startup task "{{task}}" failed', { task: taskName }), error),
  });
}
