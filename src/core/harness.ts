type CloseGuard = (sessions: string[], complete: () => void) => boolean;
let closeGuard: CloseGuard | undefined;

export function registerHarnessCloseGuard(guard: CloseGuard) {
  closeGuard = guard;
  return () => { if (closeGuard === guard) closeGuard = undefined; };
}

export function interceptHarnessClose(sessions: string[], complete: () => void) {
  return closeGuard?.(sessions, complete) ?? false;
}
