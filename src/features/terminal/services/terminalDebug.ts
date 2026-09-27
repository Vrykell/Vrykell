import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'vrykell-terminal-debug';
const REDACTED = '[redacted]';
const SENSITIVE_KEYS = new Set([
  'command', 'payload', 'raw', 'text', 'data', 'output', 'cwd', 'path', 'host', 'user',
  'token', 'secret', 'password', 'content', 'error', 'branch', 'argv', 'args', 'shell', 'message',
]);

function sanitizeDetail(value: unknown, key?: string, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (key && SENSITIVE_KEYS.has(key.toLowerCase())) return REDACTED;
  if (depth === 0 && typeof value === 'string') return REDACTED;
  if (Array.isArray(value)) return value.map((item) => sanitizeDetail(item, undefined, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeDetail(child, childKey, depth + 1),
      ]),
    );
  }
  if (typeof value === 'string' && value.length > 512) return `${value.slice(0, 512)}…[truncated]`;
  return value;
}

function readInitialState(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const developmentLogging = import.meta.env.DEV;
let enabled = developmentLogging || readInitialState();

function syncBackend(next: boolean): Promise<void> {
  return Promise.resolve(invoke('terminal_debug_set', { enabled: next }))
    .then(() => undefined)
    .catch(() => undefined);
}

if (enabled) {
  void syncBackend(true).then(() => {
    terminalDebug('diagnostics-start', { mode: developmentLogging ? 'development' : 'enabled' });
  });
}

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
  void syncBackend(next);
  console.info(`[terminal-debug] ${next ? 'enabled' : 'disabled'}`);
  return next;
}

export function terminalDebug(event: string, detail?: unknown): void {
  if (!enabled) return;
  const safeDetail = detail === undefined ? {} : sanitizeDetail(detail);
  console.debug(`[terminal-debug] ${event}`, safeDetail);
  void Promise.resolve(invoke('terminal_debug_record', { event, detail: safeDetail })).catch(() => {});
}
