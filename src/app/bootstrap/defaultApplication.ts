import { setDefaultStream, useChatStore } from '@features/chat';
import { refreshAiConfig, refreshToolPolicy } from '@features/agent';
import { agentStream } from '@features/agent/services/agentStream';
import { initAutoTitle } from '@features/agent/services/title';
import { initScheduleRunner } from '@features/agent/services/scheduleRunner';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useHistoryStore } from '@features/terminal/stores/history';
import { restoreWorkspace } from '@features/workspace';
import { createApplicationBootstrap } from '@app/bootstrap/applicationBootstrap';
import { useToastStore } from '@ui/Toast';
import { getShellLaunchDirectory } from '@platform/contextMenu';
import { t } from '@i18n';

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
      const launchDirectory = await getShellLaunchDirectory().catch(error => {
        reportFailure(t('Could not open the requested directory'), error);
        return null;
      });
      await restoreWorkspace({ onError: reportFailure, launchDirectory });
    },
    loadWorkspaceDirs: () => useWorkspaceDirsStore.getState().load(),
    hydrateHistory: () => useHistoryStore.getState().hydrate(),
  }, {
    onError: (taskName, error) => reportFailure(`启动任务「${taskName}」失败`, error),
  });
}
