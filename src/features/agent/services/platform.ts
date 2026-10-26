/** Typed access to the local memory store. */
import { invoke } from '@platform/diagnostics';

// ── 记忆 ──

export interface MemoryRecord {
  id: string;
  scope: string;
  key: string;
  content: string;
  status: 'active' | 'inactive' | 'pending';
  source: string;
  updatedAt: number;
  expiresAt: number;
  revision: number;
}
export interface MemoryQuery {
  scope?: string; query?: string; includeInactive?: boolean; offset?: number; limit?: number;
}
export type MemoryWrite = Omit<MemoryRecord, 'id' | 'updatedAt' | 'revision' | 'expiresAt'> & {
  id?: string; expectedRevision?: number; expiresAt?: number;
};
export const queryMemories = (input: MemoryQuery) => invoke<MemoryRecord[]>('query_memories', { input });
export interface MemoryStats { total: number; active: number; pending: number; inactive: number; expired: number }
export const memoryStats = () => invoke<MemoryStats>('memory_stats');
export const saveMemory = (input: MemoryWrite, authorization?: { lease: string | null; action: 'append' | 'update' }) =>
  invoke<MemoryRecord>('save_memory', { input, ...authorization });
