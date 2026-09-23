import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'vrykell-terminal-debug';

function readInitialState(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let enabled = readInitialState();

function syncBackend(next: boolean): void {
  void Promise.resolve(invoke('terminal_debug_set', { enabled: next })).catch(() => {});
}

if (enabled) syncBackend(true);

export function isTerminalDebugEnabled(): boolean {
  return enabled;
}

export function setTerminalDebugEnabled(next: boolean): boolean {
  enabled = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Logging remains available for the current process when storage is unavailable.
  }
  syncBackend(next);
  console.info(`[terminal-debug] ${next ? 'enabled' : 'disabled'}`);
  return next;
}

export function terminalDebug(event: string, detail?: unknown): void {
  if (!enabled) return;
  if (detail === undefined) console.debug(`[terminal-debug] ${event}`);
  else console.debug(`[terminal-debug] ${event}`, detail);
}
