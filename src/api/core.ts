/**
 * PTY / Session commands (Renderer → Backend)
 */
import { invoke } from '@tauri-apps/api/core';
import type { SessionInfo, SessionOptions } from '@shared/types';

export function createPTY(opts: SessionOptions): Promise<SessionInfo> {
  return invoke('create_pty', {
    shell: opts.shell || null,
    cwd: opts.cwd || null,
    cols: opts.cols || null,
    rows: opts.rows || null,
  });
}

export function writeToPTY(sessionId: string, data: string): Promise<void> {
  return invoke('write_pty', { sessionId, data });
}

export function resizePTY(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke('resize_pty', { sessionId, cols, rows });
}

export function closePTY(sessionId: string): Promise<void> {
  return invoke('close_pty', { sessionId });
}

export function hasForegroundProcess(sessionId: string): Promise<boolean> {
  return invoke('has_foreground_process', { sessionId });
}
