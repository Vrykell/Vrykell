import { invoke } from '@platform/diagnostics';
export interface ShellCompletion { text: string; cursor: number }
export function completeShell(text: string, cursor: number, cwd?: string, shell?: string): Promise<ShellCompletion[]> {
  return invoke('shell_complete', { text, cursor, cwd: cwd ?? null, shell: shell ?? null });
}
