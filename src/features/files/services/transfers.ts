import { invoke } from '@platform/diagnostics';

export type TransferStatus = 'running' | 'paused' | 'interrupted' | 'failed' | 'cancelled' | 'completed';
export interface TransferJob {
  id: string;
  connectionId: string;
  connectionName: string;
  direction: 'upload' | 'download';
  name: string;
  localPath: string;
  remotePath: string;
  isDir: boolean;
  status: TransferStatus;
  bytes: number;
  total: number;
  speed: number;
  error: string;
  createdAt: number;
}

export const transfersList = () => invoke<TransferJob[]>('transfers_list');
export const transfersControl = (id: string, action: 'pause' | 'resume' | 'cancel') => invoke<void>('transfers_control', { id, action });
export const transfersDelete = (id: string) => invoke<void>('transfers_delete', { id });

export function transferPercent(job: Pick<TransferJob, 'bytes' | 'total' | 'status'>): number {
  return job.status === 'completed' ? 100 : job.total > 0 ? Math.min(100, Math.max(0, job.bytes / job.total * 100)) : 0;
}

export const transfersClear = (direction: 'upload' | 'download') => invoke<void>('transfers_clear', { direction });
