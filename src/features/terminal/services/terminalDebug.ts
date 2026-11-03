import { diagnostic, isDiagnosticInputTraceEnabled, setDiagnosticAutoSave, useDiagnosticSettings } from '@platform/diagnostics';

export function isTerminalDebugEnabled(): boolean {
  return useDiagnosticSettings.getState().autoSave;
}

/** Per-key and per-repaint events are recorded only while the explicit trace switch is on. */
export function isTerminalInputTraceEnabled(): boolean {
  return isDiagnosticInputTraceEnabled();
}

export function setTerminalDebugEnabled(next: boolean): boolean {
  void setDiagnosticAutoSave(next).catch(() => {});
  return next;
}

export function terminalDebug(event: string, detail?: unknown): void {
  diagnostic(event, detail);
}
