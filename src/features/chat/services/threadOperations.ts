import { t } from '@i18n';
import { presentWorkspaceResource } from '@features/workspace/services/unifiedWorkspace';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { useHarnessStore, type HarnessSession } from '../stores/harness';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { agentDrivers } from './agentDrivers';
import { visibleAssistantText } from '../model/providerMarkup';

import { useChildTasks, type ChildTask, type Thread } from '../stores/childTasks';
export type { Thread } from '../stores/childTasks';

const cancellations = new Map<string, () => void>();

export function threadKey(thread: Thread, session?: HarnessSession) {
  return thread.driver === 'builtin'
    ? `chat:${thread.id}`
    : JSON.stringify(['acp', session?.harness, session?.transcriptSessionId ?? session?.resumeSessionId ?? thread.id]);
}

function show(thread: Thread, side: boolean) {
  const workspace = useAiWorkspace.getState();
  const resource = agentDrivers[thread.driver].prefix + thread.id;
  if (side) workspace.selectSide(resource);
  else {
    if (thread.driver === 'builtin') {
      workspace.openNative(thread.id);
      void useChatStore.getState().selectConversation(thread.id);
    } else {
      useHarnessWorkspace.getState().select(thread.id);
      workspace.select(resource);
    }
    presentWorkspaceResource(resource);
  }
}

export function supportsHeadFork(session?: HarnessSession): boolean {
  const capabilities = session?.agent?.agentCapabilities?.sessionCapabilities;
  return !!capabilities && typeof capabilities === 'object' && 'fork' in capabilities && capabilities.fork != null;
}

export async function forkThread(parent: Thread, answer: string, question: string) {
  const side = useAiWorkspace.getState().sideSelected === agentDrivers[parent.driver].prefix + parent.id;
  if (parent.driver === 'builtin') {
    const id = await useChatStore.getState().forkConversation(parent.id, answer);
    show({ driver: 'builtin', id }, side);
    return;
  }
  const session = useHarnessStore.getState().byTab[parent.id];
  if (
    !session?.resumeSessionId ||
    session.pending ||
    !supportsHeadFork(session) ||
    session.messages
      .slice()
      .reverse()
      .find((msg) => msg.role === 'user')?.id !== question
  )
    throw new Error(t('Thread is unavailable'));
  const id = useHarnessWorkspace.getState().connect(session.harness, session.cwd, true);
  try {
    await useHarnessStore.getState().open(id, session.harness, session.cwd, true, undefined, session.resumeSessionId);
    const child = useHarnessStore.getState().byTab[id];
    if (!child?.sessionId) throw new Error(child?.error || t('Thread is unavailable'));
    if (!child.messages.length)
      useHarnessStore.setState((state) => ({
        byTab: {
          ...state.byTab,
          [id]: { ...child, messages: session.messages.map((message) => ({ ...message, id: crypto.randomUUID() })) },
        },
      }));
    show({ driver: 'acp', id }, side);
  } catch (error) {
    useHarnessWorkspace.getState().close([id]);
    throw error;
  }
}

function update(id: string, values: Partial<ChildTask>) {
  useChildTasks.setState((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...values } : task)) }));
}
function finalAnswer(messages?: ChatMessage[]) {
  return messages
    ?.slice()
    .reverse()
    .find((message) => message.role === 'assistant');
}
export function cancelChild(task: ChildTask) {
  cancellations.get(task.id)?.();
}

export function openAnalysisParent(task: ChildTask, side: boolean) {
  if (task.mode !== 'analysis' || !task.parent.startsWith('chat:')) return;
  show({ driver: 'builtin', id: task.parent.slice(5) }, side);
}

export function openChild(task: ChildTask, side: boolean) {
  let thread = task.thread;
  if (thread.driver === 'builtin' && !useChatStore.getState().conversations.some((entry) => entry.id === thread.id)) {
    throw new Error(t('Thread is unavailable'));
  }
  if (task.agent.driver === 'acp' && !useHarnessWorkspace.getState().connections.some((c) => c.id === thread.id)) {
    if (!task.resume) throw new Error(t('Thread is unavailable'));
    thread = { driver: 'acp', id: useHarnessWorkspace.getState().connect(task.agent.name, task.cwd, false, task.resume) };
    update(task.id, { thread });
  }
  show(thread, side);
}

export async function delegateAnalysis(
  parent: { driver: 'builtin'; id: string },
  question: string,
  instruction: string,
  signal: AbortSignal,
  toolCallId?: string,
) {
  if (signal.aborted) throw new Error(t('Stopped'));
  if (!instruction.trim()) throw new Error(t('Enter a task'));
  const parentKey = threadKey(parent);
  const siblings = useChildTasks.getState().tasks.filter((item) => item.parent === parentKey && item.question === question);
  if (siblings.length >= 4 || siblings.filter((item) => item.status === 'running').length >= 2) {
    throw new Error(t('This turn has reached its subagent limit'));
  }
  const chat = useChatStore.getState();
  const childId = chat.createConversation(null, { activate: false });
  const task: ChildTask = {
    id: crypto.randomUUID(),
    parent: parentKey,
    question,
    agent: { driver: 'builtin' },
    mode: 'analysis',
    thread: { driver: 'builtin', id: childId },
    toolCallId,
    status: 'running',
  };
  let stopped = false;
  let cancel!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => {
      if (stopped) return;
      stopped = true;
      chat.abortStream(childId);
      reject(new Error(t('Stopped')));
    };
  });
  cancellations.set(task.id, cancel);
  signal.addEventListener('abort', cancel, { once: true });
  useChildTasks.setState((state) => ({ tasks: [...state.tasks, task] }));
  try {
    const result = await Promise.race([
      cancelled,
      !signal.aborted && !stopped && chat.send(instruction, { conversationId: childId, analysisOnly: true }),
    ]);
    const answer = finalAnswer(useChatStore.getState().byTab[childId]);
    if (stopped || answer?.stopped) {
      stopped = true;
      throw new Error(t('Stopped'));
    }
    if (!result || !answer || answer.error) throw new Error(answer?.errorSummary || t('Thread action failed'));
    const content = visibleAssistantText(
      answer.parts?.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('\n\n') || answer.content,
    ).trim();
    if (!content) throw new Error(t('No text result is available'));
    update(task.id, { status: 'completed', answerId: answer.id });
    return content;
  } catch (error) {
    update(task.id, { status: stopped || signal.aborted ? 'stopped' : 'failed' });
    throw error;
  } finally {
    cancellations.delete(task.id);
    signal.removeEventListener('abort', cancel);
  }
}
