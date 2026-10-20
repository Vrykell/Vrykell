import { termInstances } from '../stores/terminal';
import type { IMarker } from '@xterm/xterm';
import { posixScriptCommand } from '../model/commandSubmission';

export interface ShellCommandCompletion {
  wrap: (command: string) => string;
  result: () => { exitCode: number; output: string } | null;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
}

/** Use the terminal parser to observe a private completion marker from a POSIX shell. */
export function watchShellCommandCompletion(paneId: string): ShellCommandCompletion | null {
  const terminal = termInstances.get(paneId);
  if (!terminal?.parser) return null;
  const token = `command-${crypto.randomUUID()}`;
  const buffer = terminal.buffer.active;
  let start = buffer.baseY + buffer.cursorY;
  let startColumn = 0;
  let startMarker: IMarker | undefined;
  let completed: { exitCode: number; output: string } | null = null;
  const listeners = new Set<() => void>();
  const handler = terminal.parser.registerOscHandler(777, data => {
    const [id, status] = data.split(';');
    if (id !== token) return false;
    if (status === 'start') {
      const active = terminal.buffer.active;
      start = active.baseY + active.cursorY;
      startColumn = active.cursorX;
      startMarker?.dispose();
      startMarker = terminal.registerMarker(0);
      return true;
    }
    if (!status || !/^\d+$/.test(status)) return false;
    const active = terminal.buffer.active;
    const end = active.baseY + active.cursorY;
    const lines: string[] = [];
    const first = startMarker?.isDisposed ? Math.max(0, end - 200) : startMarker?.line ?? start;
    for (let row = Math.max(first, end - 200); row <= end; row++) {
      const line = active.getLine(row)?.translateToString(true) ?? '';
      if (!line.includes(token)) lines.push(row === first ? line.slice(startColumn) : line);
    }
    completed = { exitCode: Number(status), output: lines.join('\n').trimEnd() };
    for (const listener of listeners) listener();
    return true;
  });
  return {
    // Keep execution and status capture in one shell statement, before prompt hooks can run.
    wrap: command => `printf '\\033]777;${token};start\\007'; ${posixScriptCommand(command)}; printf '\\033]777;${token};%s\\007' "$?"\n`,
    result: () => completed,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => { handler.dispose(); startMarker?.dispose(); listeners.clear(); },
  };
}
