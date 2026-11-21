import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentInstance } from '../model/agentCatalog';

export type Thread = { driver: 'builtin' | 'acp'; id: string };
export type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped';
export interface ChildTask {
  id: string;
  parent: string;
  question: string;
  agent: AgentInstance;
  thread: Thread;
  mode?: 'analysis';
  toolCallId?: string;
  resume?: string;
  cwd?: string;
  status: TaskStatus;
  answerId?: string;
}
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

export function analysisChild(tasks: ChildTask[], conversationId: string) {
  return tasks.find((task) => task.mode === 'analysis' && task.thread.driver === 'builtin' && task.thread.id === conversationId);
}
