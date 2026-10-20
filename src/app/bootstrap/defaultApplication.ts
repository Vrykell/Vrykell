import { setDefaultStream, useChatStore } from '@features/chat';
import { refreshAiConfig, refreshToolPolicy } from '@features/agent';
import { agentStream } from '@features/agent/services/agentStream';
import { initAutoTitle } from '@features/agent/services/title';
import { initScheduleRunner } from '@features/agent/services/scheduleRunner';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useHistoryStore } from '@features/terminal/stores/history';
import { initForwardedLaunch, restoreWorkspace } from '@features/workspace';
import { createApplicationBootstrap } from '@app/bootstrap/applicationBootstrap';
import { useToastStore } from '@ui/Toast';
import { getShellLaunchDirectory } from '@platform/contextMenu';
import { ptyCloseAll } from '@platform/pty';
import { t } from '@i18n';

/** Page-scope sweep: a strict-mode replay must share one close call, not race a second one. */
let staleSessionsClosed: Promise<void> | null = null;

function closeStalePtySessions(): Promise<void> {
  staleSessionsClosed ??= ptyCloseAll()
    .then(() => undefined)
    .catch(error => {
      console.warn('[terminal] failed to close stale PTY sessions:', error);
    });
  return staleSessionsClosed;
}

/** 默认应用运行时依赖，集中在 app 层，业务组件不再承担启动编排。 */
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
    startScheduleRunner: initScheduleRunner,
    restoreWorkspace: async () => {
      // A page reload keeps the Rust process and its PTY sessions alive; terminate the
      // previous page's shells before the restored tabs start their own.
      await closeStalePtySessions();
      const launchDirectory = await getShellLaunchDirectory().catch(error => {
        reportFailure(t('Could not open the requested directory'), error);
        return null;
      });
      await restoreWorkspace({ onError: reportFailure, launchDirectory });
      // Subscribe only after the explicit launch is placed: a redirect that arrived meanwhile
      // waits in the queue and becomes its own tab instead of hiding the requested directory.
      await initForwardedLaunch(reportFailure);
    },
    loadWorkspaceDirs: () => useWorkspaceDirsStore.getState().load(),
    hydrateHistory: () => useHistoryStore.getState().hydrate(),
  }, {
    onError: (taskName, error) => reportFailure(`启动任务「${taskName}」失败`, error),
  });
}
