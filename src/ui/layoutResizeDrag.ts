/**
 * Tracks a pointer drag that changes the layout (panel edges and pane dividers) between mousedown
 * and mouseup. Terminals keep their local grid following the pointer, but tell the remote PTY
 * nothing until the drag ends: every intermediate notification makes the remote redraw its prompt,
 * so a per-step SIGWINCH moves the visible content on every column and leaves reprint artifacts
 * in the scrollback.
 *
 * Nested-safe and deliberately lifetime-free: a handle may unmount mid-drag, so ending is driven
 * by the pointer release, not by component teardown.
 */
const endListeners = new Set<() => void>();
let activeDrags = 0;

/** Mark the start of a layout resize drag. */
export function beginLayoutResizeDrag(): void {
  activeDrags += 1;
}

/** Mark the end of a layout resize drag; the last end notifies every listener. */
export function endLayoutResizeDrag(): void {
  if (activeDrags === 0) return;
  activeDrags -= 1;
  if (activeDrags === 0) {
    for (const listener of [...endListeners]) listener();
  }
}

/** Whether a layout resize drag is currently held by the pointer. */
export function isLayoutResizeDragActive(): boolean {
  return activeDrags > 0;
}

/** Run `listener` when the last active layout resize drag ends. Returns an unsubscribe. */
export function onLayoutResizeDragEnd(listener: () => void): () => void {
  endListeners.add(listener);
  return () => { endListeners.delete(listener); };
}
