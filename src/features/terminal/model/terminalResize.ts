import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

/** Let the terminal resize its renderer without explicitly clearing the current frame. */
export function fitTerminal(term: Terminal, fit: FitAddon): void {
  const dims = fit.proposeDimensions();
  if (dims && Number.isFinite(dims.cols) && Number.isFinite(dims.rows)
    && dims.cols >= 2 && dims.rows >= 1
    && (dims.cols !== term.cols || dims.rows !== term.rows)) {
    resizeTerminal(term, dims.cols, dims.rows);
  }
}

/**
 * Repaint the whole viewport from the buffer.
 *
 * A pane that was hidden (display:none while its tab or panel was inactive) comes back
 * with an unpainted surface: a static alternate-screen application produces no output to
 * trigger a repaint, and a WebGL context lost while hidden steps down to the DOM renderer
 * without drawing any rows. Repainting on the hidden-to-visible transition restores it.
 */
export function repaintTerminal(term: Terminal): void {
  if (term.rows <= 0) return;
  // Invalidate cached GPU cells as well as requesting rows: a restored canvas may
  // be empty even though the renderer's model still matches the terminal buffer.
  term.clearTextureAtlas?.();
  term.refresh(0, term.rows - 1);
}

/** Keep a visible terminal resize and its repaint in the same presentation frame. */
export function resizeTerminal(term: Terminal, cols: number, rows: number): void {
  if (cols === term.cols && rows === term.rows) return;
  term.resize(cols, rows);
  // Canvas resizing clears its pixels synchronously, while the normal repaint waits
  // for another animation frame. Finish that repaint before this frame is presented.
  // Keep version-sensitive renderer access in this adapter only.
  const renderService = (term as unknown as {
    _core?: { _renderService?: { _renderRows?: (start: number, end: number) => void } };
  })._core?._renderService;
  renderService?._renderRows?.(0, term.rows - 1);
}

/** Send the first size immediately and retain only the latest size while IPC is busy. */
export function createResizeQueue(send: (cols: number, rows: number) => Promise<unknown>, minIntervalMs = 0) {
  let pending: { cols: number; rows: number } | null = null;
  let last = '';
  let busy = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentAt = 0;
  const flush = () => {
    if (busy || disposed || !pending) return;
    // A window-edge drag arrives as a stream of sizes. Waiting out the interval folds a burst
    // into one notification, and the size the drag ends on is still delivered by the trailing
    // flush. The local grid is unaffected: it follows the pointer every frame.
    if (minIntervalMs > 0) {
      const wait = minIntervalMs - (Date.now() - lastSentAt);
      if (wait > 0) {
        if (!timer) timer = setTimeout(() => { timer = null; flush(); }, wait);
        return;
      }
    }
    const size = pending;
    pending = null;
    const key = `${size.cols}:${size.rows}`;
    if (key === last) return;
    last = key;
    busy = true;
    lastSentAt = Date.now();
    void send(size.cols, size.rows).catch(() => { last = ''; }).finally(() => {
      busy = false;
      flush();
    });
  };
  return {
    request(cols: number, rows: number) {
      if (disposed || !Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 1) return;
      pending = { cols, rows };
      flush();
    },
    dispose() {
      disposed = true;
      pending = null;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
}
