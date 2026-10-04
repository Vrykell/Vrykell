import type { Terminal, IMarker } from '@xterm/xterm';

export interface BufferTruncationTracker {
  pause(): void;
  resume(): void;
  dispose(): void;
}

/** Count discarded buffer rows, not rows that merely entered scrollback. */
export function trackBufferTruncation(term: Terminal, onTrim: (lines: number) => void): BufferTruncationTracker {
  let marker: IMarker | undefined;
  let markerLine = 0;
  let paused = false;
  const reset = () => {
    marker?.dispose();
    marker = term.registerMarker(term.rows - 1 - term.buffer.active.cursorY);
    markerLine = marker?.line ?? 0;
  };
  reset();
  const subscription = term.onScroll(() => {
    if (paused || term.buffer.active.type !== 'normal') return;
    // The tail marker shifts only when earlier rows leave the buffer. Reset it on
    // every scroll so even a single large write cannot scroll it out of history.
    if (marker && !marker.isDisposed && marker.line < markerLine) onTrim(markerLine - marker.line);
    reset();
  });
  return {
    pause: () => { paused = true; },
    resume: () => { reset(); paused = false; },
    dispose: () => { subscription.dispose(); marker?.dispose(); },
  };
}
