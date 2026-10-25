import { interceptHarnessClose } from '@core/harness';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useChatStore } from '../stores/chat';

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
