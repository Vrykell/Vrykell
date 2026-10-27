import { interceptHarnessClose } from '@core/harness';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useChatStore } from '../stores/chat';

export function closeAiWorkspaceSession(id = useAiWorkspace.getState().selected, force = false) {
  if (id.startsWith('chat:')) { useChatStore.getState().abortStream(id.slice(5)); useAiWorkspace.getState().closeNative(id.slice(5)); }
  else if (id.startsWith('acp:')) {
    const connection = id.slice(4);
    const complete = () => useHarnessWorkspace.getState().close([connection]);
    if (force || !interceptHarnessClose([connection], complete)) complete();
  }
}
