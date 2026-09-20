import { setDefaultStream } from '@features/chat';
import { refreshAiConfig } from '@features/agent';
import { agentStream } from '@features/agent/services/agentStream';
import { initAutoTitle } from '@features/agent/services/title';
import { initScheduleRunner } from '@features/agent/services/scheduleRunner';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useHistoryStore } from '@features/terminal/stores/history';
import { restoreWorkspace } from '@features/workspace';
import { createApplicationBootstrap } from '@app/bootstrap/applicationBootstrap';

/** 默认应用运行时依赖，集中在 app 层，业务组件不再承担启动编排。 */
export function startDefaultApplication(): () => void {
  return createApplicationBootstrap({
    configureAgentStream: () => setDefaultStream(agentStream),
    refreshAiConfig,
    subscribeAutoTitle: initAutoTitle,
    startScheduleRunner: initScheduleRunner,
    restoreWorkspace,
    loadWorkspaceDirs: () => useWorkspaceDirsStore.getState().load(),
    hydrateHistory: () => useHistoryStore.getState().hydrate(),
  });
}
