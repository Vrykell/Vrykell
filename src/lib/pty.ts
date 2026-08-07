import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function ptySpawn(cols: number, rows: number, cwd?: string): Promise<string> {
  return invoke('pty_spawn', { cols, rows, cwd: cwd ?? null });
}

export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke('pty_write', { id, data });
}

export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { id, cols, rows });
}

export function ptyClose(id: string): Promise<void> {
  return invoke('pty_close', { id });
}

export function onPtyOutput(cb: (id: string, data: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string; data: string }>('pty-output', (e) => cb(e.payload.id, e.payload.data));
}

export function onPtyExit(cb: (id: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string }>('pty-exit', (e) => cb(e.payload.id));
}
