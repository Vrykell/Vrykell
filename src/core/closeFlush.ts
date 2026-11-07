/**
 * closeFlush — persistence that must finish before the native window closes.
 *
 * The browser's `pagehide` cannot await asynchronous work, so the native close request pauses once,
 * lets every registered flush finish within a short budget, and only then closes the window.
 */
type Flush = () => Promise<void>;

const flushes = new Map<string, Flush>();

/** Register one owner's flush; the disposer removes only the exact registration it installed. */
export function registerCloseFlush(id: string, flush: Flush): () => void {
  flushes.set(id, flush);
  return () => { if (flushes.get(id) === flush) flushes.delete(id); };
}

/** Run every registered flush with a bounded wait; a slow or failing owner never blocks closing. */
export async function flushBeforeClose(budgetMs = 2000): Promise<void> {
  if (!flushes.size) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([...flushes.values()].map(flush => flush())),
    new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); }),
  ]);
  clearTimeout(timer);
}
