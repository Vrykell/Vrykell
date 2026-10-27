import { useEffect } from 'react';
import { useUnifiedWorkspace } from '../stores/unifiedWorkspace';
import { workspaceAreaStores } from '../stores/paneWorkspace';
import { useWorkbenchStore } from '../stores/workbench';
import { currentWorkspaceResources } from '../services/workspaceResources';
import { captureContainerHistory, containerHistoryIdentity, persistContainerHistory } from '../services/workspaceHistory';
import { panesOf, type WorkspaceContainer, type WorkspaceScope } from '../model/workbench';
import { reportWorkbenchFailure } from '../stores/workbenchFeedback';
import type { WorkspaceResource } from '../model/workspaceResources';
import { useHarnessStore } from '@features/chat/stores/harness';
import { useChatStore } from '@features/chat/stores/chat';
import { hasChatContent } from '@features/chat/model/chatContent';
import { useBlockStore } from '@features/terminal/stores/blocks';

/** Every scope saves the same tab snapshot through one serialized history writer. */
export function useWorkspaceHistory(resources: WorkspaceResource[], store = useUnifiedWorkspace) {
  const scope = (Object.entries(workspaceAreaStores).find(([, value]) => value === store)?.[0] ?? 'unified') as WorkspaceScope;
  const agentRevision = useHarnessStore(state => JSON.stringify(Object.entries(state.byTab).map(([id, session]) => [id, session.sessionId, session.messages.some(hasChatContent)])));
  const chatRevision = useChatStore(state => JSON.stringify(Object.entries(state.byTab).map(([id, messages]) => [id, messages.some(hasChatContent)])));
  const terminalRevision = useBlockStore(state => JSON.stringify(Object.entries(state.byTab).map(([id, blocks]) => [id, blocks.some(block => block.command.trim() || block.outputText.trim() || block.outputRaw.trim())])));
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const save = (tab: WorkspaceContainer) => {
      if (tab.scope !== scope || tab.scope === 'terminal') return;
      if (panesOf(tab).length < 2 && !tab.groupId && !tab.historyIdentity) return;
      const snapshot = captureContainerHistory(tab, currentWorkspaceResources());
      let target = tab;
      const retry = () => {
        const operation = persistContainerHistory(target, snapshot);
        target = { ...target, historyIdentity: containerHistoryIdentity(target) };
        void operation.catch(error => reportWorkbenchFailure(error, retry));
      };
      retry();
    };
    for (const tab of useWorkbenchStore.getState().snapshot.tabs) save(tab);
    const unsubscribe = useWorkbenchStore.subscribe((state, previous) => {
      for (const tab of state.snapshot.tabs) {
        if (tab.scope !== scope || previous.snapshot.tabs.find(item => item.id === tab.id) === tab) continue;
        clearTimeout(timers.get(tab.id));
        timers.set(tab.id, setTimeout(() => { save(tab); timers.delete(tab.id); }, 200));
      }
      for (const tab of previous.snapshot.tabs) if (!state.snapshot.tabs.some(item => item.id === tab.id)) {
        clearTimeout(timers.get(tab.id)); timers.delete(tab.id);
      }
    });
    return () => { unsubscribe(); for (const timer of timers.values()) clearTimeout(timer); };
  }, [scope, resources.map(resource => resource.id).join('|'), agentRevision, chatRevision, terminalRevision]);
}
