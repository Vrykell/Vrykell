import { diagnostic, setDiagnosticAutoSave, useDiagnosticSettings } from '@platform/diagnostics';

export function isTerminalDebugEnabled(): boolean {
  return useDiagnosticSettings.getState().autoSave;
}

export function setTerminalDebugEnabled(next: boolean): boolean {
  void setDiagnosticAutoSave(next).catch(() => {});
  return next;
}

export function terminalDebug(event: string, detail?: unknown): void {
  diagnostic(event, detail);
}
