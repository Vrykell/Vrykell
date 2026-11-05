/**
 * Coalesced editor edits that have not reached their document yet.
 *
 * The editor reports text on a short timer so holding a key never re-renders the workspace per
 * character. Saving and closing must observe the newest text, so both paths flush first.
 */
const flushes = new Set<() => void>();

export function registerEditorChangeFlush(flush: () => void): () => void {
  flushes.add(flush);
  return () => { flushes.delete(flush); };
}

export function flushEditorChanges(): void {
  for (const flush of [...flushes]) flush();
}
