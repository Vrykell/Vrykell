import { create } from 'zustand';

/** Why a paste asks before it reaches the PTY. */
export type PasteConfirmReason = 'lines' | 'size';

export interface PasteConfirmRequest {
  reason: PasteConfirmReason;
  /** Lines the pasted text spans. */
  lines: number;
  /** Characters the pasted text spans. */
  chars: number;
}

interface PasteConfirmState {
  request: PasteConfirmRequest | null;
}

export const usePasteConfirmStore = create<PasteConfirmState>(() => ({ request: null }));

let pending: ((confirmed: boolean) => void) | null = null;

/**
 * Ask the user before a large or multi-line paste reaches the PTY. Callers await the answer. A
 * pending question is answered with "no" when a second one arrives, so a stale dialog can never
 * release the newer paste.
 */
export function requestPasteConfirm(request: PasteConfirmRequest): Promise<boolean> {
  settlePasteConfirm(false);
  usePasteConfirmStore.setState({ request });
  return new Promise<boolean>((resolve) => { pending = resolve; });
}

/** Close the dialog and answer the pending request. */
export function settlePasteConfirm(confirmed: boolean): void {
  const resolve = pending;
  pending = null;
  if (usePasteConfirmStore.getState().request) usePasteConfirmStore.setState({ request: null });
  resolve?.(confirmed);
}
