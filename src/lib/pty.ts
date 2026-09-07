import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DispatchEvent } from '@/terminal/pipeline/events';

/** SSH 连接目标（透传给 Rust pty_spawn 的 ssh 参数） */
export interface SshSpawnTarget {
  host: string;
  user?: string;
  port?: number;
}

export interface PtySpawnOptions {
  /** 本地 shell 类型（zsh / bash / powershell / pwsh / cmd），缺省走 $SHELL 探测 */
  shell?: string;
  /** SSH 连接目标；与 shell 互斥，优先 SSH */
  ssh?: SshSpawnTarget | null;
  /** 打开模式：classic = 不注入；block = SSH 注入远端 shell integration */
  openMode?: 'classic' | 'block';
}

export function ptySpawn(
  cols: number,
  rows: number,
  cwd?: string,
  opts?: PtySpawnOptions,
): Promise<string> {
  return invoke('pty_spawn', {
    cols,
    rows,
    cwd: cwd ?? null,
    shell: opts?.shell ?? null,
    ssh: opts?.ssh ?? null,
    openMode: opts?.openMode ?? null,
  });
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

export function onPtyOutput(
  cb: (id: string, events: DispatchEvent[]) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string; events: DispatchEvent[] }>('pty-output', (e) =>
    cb(e.payload.id, e.payload.events),
  );
}

export function onPtyExit(cb: (id: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string }>('pty-exit', (e) => cb(e.payload.id));
}
