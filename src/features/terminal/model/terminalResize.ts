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
export function createResizeQueue(send: (cols: number, rows: number) => Promise<unknown>) {
  let pending: { cols: number; rows: number } | null = null;
  let last = '';
  let busy = false;
  let disposed = false;
  const flush = () => {
    if (busy || disposed || !pending) return;
    const size = pending;
    pending = null;
    const key = `${size.cols}:${size.rows}`;
    if (key === last) return;
    last = key;
    busy = true;
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
    dispose() { disposed = true; pending = null; },
  };
}
