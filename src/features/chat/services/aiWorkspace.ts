import { interceptHarnessClose } from '@core/harness';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';

export function closeAiWorkspaceSession(id = useAiWorkspace.getState().selected) {
  if (id.startsWith('chat:')) useAiWorkspace.getState().closeNative(id.slice(5));
  else if (id.startsWith('acp:')) {
    const connection = id.slice(4);
    const complete = () => useHarnessWorkspace.getState().close([connection]);
    if (!interceptHarnessClose([connection], complete)) complete();
  }
}
