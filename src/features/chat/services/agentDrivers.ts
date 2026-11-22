import { interceptHarnessClose } from '@core/harness';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import type { AgentInstance } from '../model/agentCatalog';
import type { TerminalReference } from '../model/conversation';
import { useChatStore } from '../stores/chat';
import { useHarnessStore } from '../stores/harness';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';

interface AgentInput {
  attachments?: AttachmentMeta[];
  references?: TerminalReference[];
}

interface SessionDriver<I extends AgentInstance> {
  prefix: string;
  create: (instance: I, main: boolean, directory?: string) => string;
  submit: (id: string, text: string, input?: AgentInput) => Promise<boolean>;
  cancel: (id: string) => void;
  close: (id: string, force: boolean) => void;
}

export const agentDrivers = {
  builtin: {
    prefix: 'chat:',
    create: (_instance, main, projectDirectory) => useChatStore.getState().createConversation(null, { activate: main, projectDirectory }),
    submit: (id, text, input) => useChatStore.getState().send(text, { ...input, conversationId: id }),
    cancel: (id) => useChatStore.getState().abortStream(id),
    close: (id) => {
      useChatStore.getState().abortStream(id);
      useAiWorkspace.getState().closeNative(id);
    },
  },
  acp: {
    prefix: 'acp:',
    create: (instance, _main, directory) => useHarnessWorkspace.getState().connect(instance.name, directory, true),
    submit: (id, text, input) => useHarnessStore.getState().prompt(id, text, input?.attachments),
    cancel: (id) => {
      void useHarnessStore.getState().cancel(id);
    },
    close: (id, force) => {
      const complete = () => useHarnessWorkspace.getState().close([id]);
      if (force || !interceptHarnessClose([id], complete)) complete();
    },
  },
} satisfies { [K in AgentInstance['driver']]: SessionDriver<Extract<AgentInstance, { driver: K }>> };

export function createAgentSession(instance: AgentInstance, placement: 'main' | 'side', directory?: string) {
  const main = placement === 'main';
  const id =
    instance.driver === 'builtin'
      ? agentDrivers.builtin.create(instance, main, directory)
      : agentDrivers.acp.create(instance, main, directory);
  const resourceId = agentDrivers[instance.driver].prefix + id;
  const workspace = useAiWorkspace.getState();
  if (!main) workspace.selectSide(resourceId);
  else if (instance.driver === 'builtin') workspace.openNative(id);
  else workspace.select(resourceId);
  return { id, resourceId };
}
