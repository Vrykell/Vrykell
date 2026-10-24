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
const pendingRecords: DiagnosticRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/** Keep detailed records while amortizing the transport cost of frequent input events. */
export function flushDiagnostics(): Promise<void> {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  const batch = pendingRecords.splice(0);
  if (batch.length) {
    writeQueue = writeQueue.then(async () => {
      for (let offset = 0; offset < batch.length; offset += 64) {
        try {
          await rawInvoke('diagnostics_records', { records: batch.slice(offset, offset + 64) });
        } catch (error) {
          useDiagnosticSettings.setState({ error: `日志写入失败：${redactText(String(error))}` });
        }
      }
    });
  }
  return writeQueue;
}
const privateKeys = /^(password|passphrase|key|apiKey|accessToken|refreshToken|token|secret|authorization|cookie|privateKey|privateKeyContent|env|environment)$/i;
const contentKeys = /^(data|raw|output|content|text|payload|prompt|command|question|messages|notes|aiNotes|cursor)$/i;

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
      pendingRecords.push(record);
      if (pendingRecords.length >= 64) void flushDiagnostics();
      else if (flushTimer === null) flushTimer = setTimeout(() => { void flushDiagnostics(); }, 50);
    }
  } catch {
    // Diagnostics must never interrupt an application operation.
  }
}

export function diagnosticSnapshot(): DiagnosticRecord[] { return [...records]; }

/** Frame gaps at or above this are a main-thread stall the user feels as lag. */
export const FRAME_STALL_MS = 250;
/** Gaps this large are the window not producing frames at all (hidden or occluded). */
export const FRAME_PAUSE_MS = 5000;

/**
 * Record one animation-frame gap of the application window. The watchdog below reports what the
 * user feels as lag - a frozen main thread freezes every frame - and keeps the two causes apart:
 * a stall while the window is on screen, versus the window being paused (no frames at all) while
 * it was hidden. The probe stays silent below {@link FRAME_STALL_MS} so ordinary frames cost
 * nothing.
 */
export function reportFrameGap(gapMs: number): void {
  if (gapMs < FRAME_STALL_MS) return;
  diagnostic(gapMs >= FRAME_PAUSE_MS ? 'frame-pause' : 'frame-stall', {
    gapMs: Math.round(gapMs),
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  });
}

/** Record the window gaining or losing focus, together with the visibility the platform reports. */
export function reportWindowFocus(focused: boolean): void {
  diagnostic(focused ? 'window-focus' : 'window-blur', {
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  });
}

export async function setDiagnosticAutoSave(enabled: boolean): Promise<void> {
  autoSaveRevision += 1;
  useDiagnosticSettings.setState({ saving: true, error: null });
  try {
    await flushDiagnostics();
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
  document.addEventListener('visibilitychange', () => {
    diagnostic('visibility-change', { state: document.visibilityState });
    if (document.visibilityState === 'hidden') void flushDiagnostics();
  });
  window.addEventListener('focus', () => reportWindowFocus(true));
  window.addEventListener('blur', () => reportWindowFocus(false));
  // The frame watchdog: a gap between frames is the most direct reading of the lag the user
  // feels, and it attributes nothing to a subsystem, so it also covers causes the terminal
  // pipeline does not know about.
  let lastFrameAt = performance.now();
  const watchFrame = () => {
    const now = performance.now();
    reportFrameGap(now - lastFrameAt);
    lastFrameAt = now;
    window.requestAnimationFrame(watchFrame);
  };
  window.requestAnimationFrame(watchFrame);
  window.addEventListener('pagehide', () => { void flushDiagnostics(); });
  const initialSettingsRevision = autoSaveRevision;
  void rawInvoke<boolean>('diagnostics_auto_save').then(autoSave => {
    if (initialSettingsRevision !== autoSaveRevision) return;
    useDiagnosticSettings.setState({ autoSave: autoSave === true });
    diagnostic('diagnostics-ready', { autoSave: autoSave === true }, 'info');
  }).catch(error => diagnostic('diagnostics-initialize-error', { error }, 'error'));
}

export async function exportDiagnostics(path: string): Promise<void> {
  await flushDiagnostics();
  await rawInvoke('diagnostics_export', { path, frontend: diagnosticSnapshot(), context: { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, build: import.meta.env.MODE } });
}

/** Absolute path of the directory that holds the hourly log segments. */
export function diagnosticsLogDirectory(): Promise<string> {
  return rawInvoke<string>('diagnostics_log_directory');
}

/** Absolute path of the current log segment file. */
export function diagnosticsLogPath(): Promise<string> {
  return rawInvoke<string>('diagnostics_log_path');
}
