/**
 * Global error handling — catches exceptions not covered by a local try/catch.
 *
 * - window.onerror: synchronous errors (syntax errors, type errors, ...)
 * - unhandledrejection: uncaught promise rejections
 * - IPC invoke failures do not arrive here (each call site handles its own)
 *
 * Design rule: never swallow errors silently — log them to the console for debugging —
 * but never let the app go blank (the error boundary owns that fallback).
 */

let installed = false;

export function installGlobalErrorHandlers() {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    // Only runtime errors; skip resource load failures (e.g. <img src=404>)
    if (event instanceof ErrorEvent) {
      console.error(
        `[global] ${event.filename}:${event.lineno}:${event.colno} ${event.message}`,
      );
    }
    // Do not call preventDefault(): keep the browser's default reporting
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(
      '[global] Unhandled Promise rejection:',
      event.reason,
    );
    // Do not call preventDefault(): keep the browser's default behavior
  });
}

/**
 * Safe JSON parsing — never throws; returns null and logs a warning.
 * Used for external data such as localStorage entries and IPC messages.
 */
export function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('[safeJson] parse failed:', (e as Error).message, 'raw:', raw.slice(0, 120));
    return null;
  }
}

/**
 * Safe localStorage read — never throws (private browsing, full quota, ...).
 */
export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('[safeLs] getItem failed:', (e as Error).message);
    return null;
  }
}

export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('[safeLs] setItem failed:', (e as Error).message);
    return false;
  }
}
