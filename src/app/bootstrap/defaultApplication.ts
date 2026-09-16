import { setDefaultStream } from '@entities/chat';
import { refreshAiConfig } from '@/lib/ai';
import { agentStream } from '@features/agent/agentStream';
import { initAutoTitle } from '@features/agent/title';
import { initScheduleRunner } from '@features/agent/scheduleRunner';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useHistoryStore } from '@/store/history';
import { restoreWorkspace } from '@entities/session';
import { createApplicationBootstrap } from '@/app/bootstrap/applicationBootstrap';

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
