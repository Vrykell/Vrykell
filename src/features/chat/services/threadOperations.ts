import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { t } from '@i18n';
import { presentWorkspaceResource } from '@features/workspace/services/unifiedWorkspace';
import type { AgentInstance } from '../model/agentCatalog';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
import { useHarnessStore, type HarnessSession } from '../stores/harness';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { agentDrivers } from './agentDrivers';
import { loadHarnessTranscript } from './harnessTranscripts';
import { visibleAssistantText } from '../model/providerMarkup';
import { groupHarnessMessages } from '../model/harnessTranscript';

export type Thread = { driver: 'builtin' | 'acp'; id: string };
export type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped';
export interface ChildTask {
  id: string;
  parent: string;
  question: string;
  agent: AgentInstance;
  thread: Thread;
  resume?: string;
  cwd?: string;
  status: TaskStatus;
  answerId?: string;
}
const running = new Map<string, () => void>();
export const useChildTasks = create<{ tasks: ChildTask[] }>()(
  persist((): { tasks: ChildTask[] } => ({ tasks: [] }), {
    name: 'agent-child-threads',
    version: 1,
    merge: (saved, initial) => {
      const tasks = (saved as { tasks?: ChildTask[] } | null)?.tasks;
      return {
        ...initial,
        tasks: Array.isArray(tasks)
          ? tasks.map((task) => (task.status === 'running' ? { ...task, status: 'stopped' as const } : task))
          : [],
      };
    },
  }),
);

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
function statusOf(answer?: ChatMessage): TaskStatus {
  if (answer?.stopped) return 'stopped';
  return !answer || answer.error ? 'failed' : 'completed';
}

export function delegateTask(parent: Thread, question: string, agent: AgentInstance, instruction: string, analysisOnly = false) {
  if (!instruction.trim()) throw new Error(t('Enter a task'));
  const external = parent.driver === 'acp' ? useHarnessStore.getState().byTab[parent.id] : undefined;
  const conversation = parent.driver === 'builtin' ? useChatStore.getState().conversations.find((c) => c.id === parent.id) : undefined;
  const environment = conversation?.environment;
  const cwd = external?.cwd ?? conversation?.projectDirectory ?? (environment?.kind === 'local' ? environment.cwd : undefined);
  const id = crypto.randomUUID();
  const child =
    agent.driver === 'builtin'
      ? useChatStore
          .getState()
          .createConversation(analysisOnly ? null : environment, { activate: false, projectDirectory: analysisOnly ? undefined : cwd })
      : useHarnessWorkspace.getState().connect(agent.name, cwd, true);
  const thread = { driver: agent.driver, id: child };
  useChildTasks.setState((state) => ({
    tasks: [
      ...state.tasks,
      {
        id,
        thread,
        parent: threadKey(parent, external),
        question,
        agent,
        cwd,
        status: 'running',
      },
    ],
  }));
  const finish = (status: TaskStatus, answerId?: string) => {
    if (!running.has(id)) return;
    running.get(id)?.();
    running.delete(id);
    update(id, { status, answerId });
  };
  running.set(id, () => {});
  const run = async () => {
    if (agent.driver === 'builtin') {
      const accepted = analysisOnly
        ? await useChatStore.getState().send(instruction, { conversationId: child, analysisOnly: true })
        : await agentDrivers.builtin.submit(child, instruction, undefined);
      const answer = finalAnswer(useChatStore.getState().byTab[child]);
      finish(accepted ? statusOf(answer) : 'failed', answer?.id);
    } else {
      await useHarnessStore.getState().open(child, agent.name, cwd ?? '', true);
      if (!running.has(id)) return;
      const session = useHarnessStore.getState().byTab[child];
      if (!session?.sessionId) {
        finish('failed');
        return;
      }
      update(id, { resume: session.transcriptSessionId ?? session.resumeSessionId, cwd: session.cwd });
      running.set(
        id,
        useHarnessStore.subscribe((state, previous) => {
          const current = state.byTab[child];
          if (!current) finish('stopped');
          else if (previous.byTab[child]?.pending && !current.pending) {
            const answer = finalAnswer(groupHarnessMessages(current.messages));
            finish(current.interrupted || current.stopping ? 'stopped' : current.error ? 'failed' : statusOf(answer), answer?.id);
          }
        }),
      );
      if (!(await agentDrivers.acp.submit(child, instruction, undefined))) finish('failed');
    }
  };
  void run().catch(() => finish('failed'));
  return id;
}

export function cancelChild(task: ChildTask) {
  if (!running.has(task.id)) return;
  running.get(task.id)?.();
  running.delete(task.id);
  update(task.id, { status: 'stopped' });
  agentDrivers[task.thread.driver].cancel(task.thread.id);
}

export function openAnalysisParent(task: import('../stores/childTasks').ChildTask, side: boolean) {
  if (task.mode !== 'analysis' || !task.parent.startsWith('chat:')) return;
  show({ driver: 'builtin', id: task.parent.slice(5) }, side);
}

export function openChild(task: ChildTask, side: boolean) {
  let thread = task.thread;
  if (task.agent.driver === 'acp' && !useHarnessWorkspace.getState().connections.some((c) => c.id === thread.id)) {
    if (!task.resume) throw new Error(t('Thread is unavailable'));
    thread = { driver: 'acp', id: useHarnessWorkspace.getState().connect(task.agent.name, task.cwd, false, task.resume) };
    update(task.id, { thread });
  }
  show(thread, side);
}

async function childResult(task: ChildTask) {
  let messages: ChatMessage[] | undefined;
  if (task.agent.driver === 'builtin') {
    await useChatStore.getState().ensureConversationMessages(task.thread.id);
    messages = useChatStore.getState().byTab[task.thread.id];
  } else {
    messages = useHarnessStore.getState().byTab[task.thread.id]?.messages;
    if (!messages?.length && task.resume) messages = (await loadHarnessTranscript(task.agent.name, task.resume))?.messages;
    if (messages) messages = groupHarnessMessages(messages);
  }
  const answer = task.answerId ? messages?.find((m) => m.id === task.answerId) : finalAnswer(messages);
  const content = visibleAssistantText(
    answer?.parts?.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('\n\n') || answer?.content || '',
  ).trim();
  if (!content) throw new Error(t('No text result is available'));
  return content;
}

export async function insertChildResult(parent: Thread, task: ChildTask) {
  const content = await childResult(task);
  const drafts = useComposerDrafts.getState();
  drafts.setText(parent.id, [drafts.byTab[parent.id]?.text, content].filter(Boolean).join('\n\n'));
}

export async function delegateAnalysis(parent: Thread, question: string, task: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error(t('Stopped'));
  const siblings = useChildTasks.getState().tasks.filter((item) => item.parent === threadKey(parent) && item.question === question);
  if (siblings.length >= 4 || siblings.filter((item) => item.status === 'running').length >= 2) {
    throw new Error(t('This turn has reached its subagent limit'));
  }
  const id = delegateTask(parent, question, { driver: 'builtin' }, task, true);
  const completed = await new Promise<ChildTask>((resolve) => {
    const check = () => {
      const child = useChildTasks.getState().tasks.find((item) => item.id === id)!;
      if (child.status === 'running') return;
      unsubscribe();
      signal.removeEventListener('abort', abort);
      resolve(child);
    };
    const abort = () => {
      const child = useChildTasks.getState().tasks.find((item) => item.id === id);
      if (child) cancelChild(child);
    };
    const unsubscribe = useChildTasks.subscribe(check);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    check();
  });
  if (completed.status !== 'completed') throw new Error(t(completed.status === 'stopped' ? 'Stopped' : 'Thread action failed'));
  return childResult(completed);
}
