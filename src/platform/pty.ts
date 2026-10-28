import { invoke } from '@platform/diagnostics';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DispatchEvent } from '@core/terminal/events';
import type { SshOptions } from '@core/ssh';

/** SSH connection target (passed through to the backend pty_spawn ssh argument). */
export interface SshSpawnTarget extends SshOptions {
  host: string;
  user?: string;
  port?: number;
  hostKeyType?: string;
}

export interface PtySpawnOptions {
  /** Local shell type (zsh / bash / powershell / pwsh / cmd); defaults to $SHELL detection. */
  shell?: string;
  /** SSH connection target; mutually exclusive with shell, SSH wins. */
  ssh?: SshSpawnTarget | null;
  /** Terminal presentation mode; block hides the native prompt in integrated shells. */
  openMode?: 'classic' | 'block';
}

const observedInputEpochs = new Map<string, number>();

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

export function ptyWrite(id: string, data: string, expectedEpoch?: number): Promise<void> {
  return invoke('pty_write', { id, data, ...(expectedEpoch === undefined ? {} : { expectedEpoch }) });
}

/** Bind pasted input to the native foreground boundary before awaiting clipboard or confirmation. */
export async function ptyInputEpoch(id: string): Promise<number> {
  const observed = observedInputEpochs.get(id);
  if (observed === undefined) throw new Error('terminal input target changed');
  const current = await invoke<number>('pty_input_epoch', { id });
  if (current !== observed) throw new Error('terminal input target changed');
  return observed;
}

export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { id, cols, rows });
}

export function ptyClose(id: string): Promise<void> {
  return invoke('pty_close', { id });
}

/** Terminate every PTY session of this process (page reload / startup sweep). */
export function ptyCloseAll(): Promise<number> {
  return invoke('pty_close_all');
}

export function onPtyOutput(cb: (id: string, events: DispatchEvent[]) => void): Promise<UnlistenFn> {
  return listen<{ id: string; events: DispatchEvent[]; inputEpoch?: number }>('pty-output', e => {
    if (typeof e.payload.inputEpoch === 'number') observedInputEpochs.set(e.payload.id, e.payload.inputEpoch);
    cb(e.payload.id, e.payload.events);
  });
}

/** `code` is the child exit code, or null when the reader ended without one. */
export function onPtyExit(cb: (id: string, code: number | null) => void): Promise<UnlistenFn> {
  return listen<{ id: string; code: number | null }>('pty-exit', (e) => cb(e.payload.id, e.payload.code ?? null));
}
