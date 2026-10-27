import { interceptHarnessClose } from '@core/harness';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useChatStore } from '../stores/chat';
import { useDockStore } from '@features/workspace/stores/dock';
import { selectWorkspaceArea } from '@features/workspace/services/selectWorkspaceArea';
import { scopedPaneStores } from '@features/workspace/stores/scopedPanes';
import { workspacePaneCells } from '@features/workspace/model/workspaceResources';
import { useWorkbenchStore } from '@features/workspace/stores/workbench';
import { panesOf, reconcileContainers } from '@features/workspace/model/workbench';

export function availableSideConversationIds(placedIds?: readonly string[]): Set<string> {
  const ai = useAiWorkspace.getState();
  const layout = scopedPaneStores.ai.getState().layout;
  const reserved = new Set([ai.selected, ...(placedIds ?? [
    ...useWorkbenchStore.getState().snapshot.tabs.filter(tab => tab.scope === 'unified' || tab.scope === 'ai' && panesOf(tab).length > 1).flatMap(panesOf).map(pane => pane.resourceId),
    ...(layout && (scopedPaneStores.ai.getState().choosingSplit || workspacePaneCells(layout).length > 1) ? workspacePaneCells(layout).map(cell => cell.resourceId) : []),
  ])]);
  const resources = new Set([...ai.nativeTabs.map(id => `chat:${id}`), ...useHarnessWorkspace.getState().connections.map(item => `acp:${item.id}`)]);
  return new Set([...ai.sideSessions, ai.sideSelected].filter(id => id && resources.has(id) && !reserved.has(id)));
}

export function moveSideConversationToMain() {
  const id = useAiWorkspace.getState().sideSelected;
  if (!id) return;
  useDockStore.getState().closePanel('chat');
  if (id.startsWith('chat:')) {
    useAiWorkspace.getState().openNative(id.slice(5));
    void useChatStore.getState().selectConversation(id.slice(5));
  } else if (id.startsWith('acp:')) {
    useAiWorkspace.getState().select(id); useHarnessWorkspace.getState().select(id.slice(4));
  }
  selectWorkspaceArea('ai');
}

export function moveMainConversationToSide(id: string) {
  useAiWorkspace.getState().selectSide(id);
  useWorkbenchStore.getState().update(state => {
    const valid = new Set(state.tabs.flatMap(panesOf).map(pane => pane.resourceId).filter(resourceId => resourceId !== id));
    return reconcileContainers(reconcileContainers(state, 'ai', valid), 'unified', valid);
  });
  useAiWorkspace.getState().select('');
}

export function createSideConversation() {
  const id = useChatStore.getState().createConversation(null, { activate: false });
  useAiWorkspace.getState().selectSide(`chat:${id}`);
  return id;
}

export function createSideAgent(harness: string, cwd?: string) {
  const id = useHarnessWorkspace.getState().connect(harness, cwd, true);
  useAiWorkspace.getState().selectSide(`acp:${id}`);
  return id;
}

export function closeAiWorkspaceSession(id = useAiWorkspace.getState().selected, force = false) {
  if (id.startsWith('chat:')) { useChatStore.getState().abortStream(id.slice(5)); useAiWorkspace.getState().closeNative(id.slice(5)); }
  else if (id.startsWith('acp:')) {
    const connection = id.slice(4);
    const complete = () => useHarnessWorkspace.getState().close([connection]);
    if (force || !interceptHarnessClose([connection], complete)) complete();
  }
}
