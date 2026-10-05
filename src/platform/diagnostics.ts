import { invoke as rawInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
import { create } from 'zustand';
export type { InvokeArgs, InvokeOptions } from '@tauri-apps/api/core';

export interface DiagnosticRecord {
  timestampMs: number;
  sequence: number;
  source: 'frontend';
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  detail: unknown;
}

const records: DiagnosticRecord[] = [];
const MAX_RECORDS = 2000;
const MAX_BYTES = 8 * 1024 * 1024;
let bytes = 0;
let sequence = 0;
let autoSaveRevision = 0;
const privateKeys = /^(password|passphrase|key|apiKey|accessToken|refreshToken|token|secret|authorization|cookie|privateKey|privateKeyContent|env)$/i;
const contentKeys = /^(data|raw|output|content|text|payload|prompt|command|question|messages)$/i;

export function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[\w-]+/g, '[redacted]')
    .replace(/((?:password|passphrase|api[_-]?key|token|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted]');
}

export function sanitizeDiagnostic(value: unknown, key = '', depth = 0): unknown {
  if (privateKeys.test(key)) return '[redacted]';
  if (contentKeys.test(key)) return { redacted: true, length: typeof value === 'string' ? value.length : undefined };
  if (depth > 6) return '[truncated]';
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: redactText(value.stack ?? '').slice(0, 4000) };
  if (typeof value === 'string') return redactText(value).slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeDiagnostic(item, '', depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([name, child]) => [name, sanitizeDiagnostic(child, name, depth + 1)]));
  return value;
}

export const useDiagnosticSettings = create<{ autoSave: boolean; saving: boolean; error: string | null }>(() => ({ autoSave: false, saving: false, error: null }));

export function diagnostic(event: string, detail: unknown = {}, level: DiagnosticRecord['level'] = 'debug'): void {
  try {
    const record: DiagnosticRecord = { timestampMs: Date.now(), sequence: ++sequence, source: 'frontend', level, event, detail: sanitizeDiagnostic(detail) };
    const length = JSON.stringify(record).length;
    records.push(record);
    bytes += length;
    while (records.length > MAX_RECORDS || bytes > MAX_BYTES) bytes -= JSON.stringify(records.shift()).length;
    if (useDiagnosticSettings.getState().autoSave) {
      void rawInvoke('terminal_debug_record', { event, detail: record }).catch(error => {
        useDiagnosticSettings.setState({ error: `日志写入失败：${redactText(String(error))}` });
      });
    }
  } catch {
    // Diagnostics must never interrupt an application operation.
  }
}

export function diagnosticSnapshot(): DiagnosticRecord[] { return [...records]; }

export async function setDiagnosticAutoSave(enabled: boolean): Promise<void> {
  autoSaveRevision += 1;
  useDiagnosticSettings.setState({ saving: true, error: null });
  try {
    await rawInvoke('diagnostics_set_auto_save', { enabled });
    useDiagnosticSettings.setState({ autoSave: enabled });
    diagnostic('diagnostics-preference', { autoSave: enabled }, 'info');
  } catch (error) {
    useDiagnosticSettings.setState({ error: `日志设置保存失败：${redactText(String(error))}` });
    throw error;
  } finally { useDiagnosticSettings.setState({ saving: false }); }
}

/** Track IPC timing and context without retaining terminal or model contents. */
export async function invoke<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const requestId = ++sequence;
  const started = performance.now();
  diagnostic('ipc-start', { requestId, commandName: command, parameters: args });
  try {
    const result = options !== undefined
      ? await rawInvoke<T>(command, args, options)
      : args !== undefined
        ? await rawInvoke<T>(command, args)
        : await rawInvoke<T>(command);
    diagnostic('ipc-complete', { requestId, commandName: command, durationMs: Math.round((performance.now() - started) * 100) / 100, resultType: Array.isArray(result) ? 'array' : typeof result, resultCount: Array.isArray(result) ? result.length : undefined });
    return result;
  } catch (error) {
    diagnostic('ipc-error', { requestId, commandName: command, durationMs: Math.round((performance.now() - started) * 100) / 100, error }, 'error');
    throw error;
  }
}

let installed = false;
export function initializeDiagnostics(): void {
  if (installed) return;
  installed = true;
  diagnostic('application-start', { userAgent: navigator.userAgent, language: navigator.language, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, build: import.meta.env.MODE }, 'info');
  for (const level of ['info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { diagnostic(`console-${level}`, { arguments: args }, level); original(...args); };
  }
  window.addEventListener('error', event => diagnostic('uncaught-error', { error: event.error, message: event.message, filename: event.filename, line: event.lineno, column: event.colno }, 'error'));
  window.addEventListener('unhandledrejection', event => diagnostic('unhandled-rejection', { error: event.reason }, 'error'));
  document.addEventListener('visibilitychange', () => diagnostic('visibility-change', { state: document.visibilityState }));
  const initialSettingsRevision = autoSaveRevision;
  void rawInvoke<boolean>('terminal_debug_status').then(autoSave => {
    if (initialSettingsRevision !== autoSaveRevision) return;
    useDiagnosticSettings.setState({ autoSave: autoSave === true });
    diagnostic('diagnostics-ready', { autoSave: autoSave === true }, 'info');
  }).catch(error => diagnostic('diagnostics-initialize-error', { error }, 'error'));
}

export async function exportDiagnostics(path: string): Promise<void> {
  await rawInvoke('diagnostics_export', { path, frontend: diagnosticSnapshot(), context: { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, build: import.meta.env.MODE } });
}
