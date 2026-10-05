/**
 * platform — 长期记忆 / 子代理 / 定时任务 的 Rust 封装与类型。
 */
import { invoke } from '@platform/diagnostics';

// ── 记忆 ──

export const getMemory = () => invoke<string>('get_memory');
export const setMemory = (content: string) => invoke<void>('set_memory', { content });
export const getMemoryJournal = () => invoke<string>('get_memory_journal');
export const appendMemoryJournal = (text: string) => invoke<void>('append_memory_journal', { text });

// ── 子代理 ──

export interface AgentDef {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export const listAgents = () => invoke<AgentDef[]>('list_agents');
export const saveAgent = (agent: AgentDef) => invoke<void>('save_agent', { agent });
export const removeAgent = (id: string) => invoke<void>('remove_agent', { id });
export const getAgent = (nameOrId: string) => invoke<AgentDef>('get_agent', { nameOrId });

// ── 定时任务 ──

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: number;
}

export const listSchedules = () => invoke<Schedule[]>('list_schedules');
export const saveSchedule = (s: Schedule) => invoke<void>('save_schedule', { schedule: s });
export const removeSchedule = (id: string) => invoke<void>('remove_schedule', { id });
export const markScheduleRun = (id: string, at: number) => invoke<void>('mark_schedule_run', { id, at });
