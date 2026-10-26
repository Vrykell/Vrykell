/**
 * Connect command writes to the live session controller without importing the terminal hook
 * into tools or history services. The registry is intentionally tiny and dependency-free.
 */
type PendingCommandRegistrar = (paneId: string, command: string, payload: string) => void;

let registrar: PendingCommandRegistrar | null = null;

export function setPendingCommandRegistrar(next: PendingCommandRegistrar | null): void {
  registrar = next;
}

/** Record the visible command for a write when a live controller is registered. */
export function registerPendingCommand(paneId: string, command: string, payload: string): void {
  registrar?.(paneId, command, payload);
}
