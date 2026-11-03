import type { Terminal } from '@xterm/xterm';
import { isTerminalInputTraceEnabled, terminalDebug } from '../services/terminalDebug';

type CursorShape = 'block' | 'underline' | 'bar';

const CURSOR_SHAPES: Record<number, CursorShape> = {
  1: 'block',
  2: 'block',
  3: 'underline',
  4: 'underline',
  5: 'bar',
  6: 'bar',
};

interface CursorModes {
  cursorStyle?: CursorShape;
  cursorBlink?: boolean;
}

function cursorModes(term: Terminal): CursorModes | null {
  const modes = (term as unknown as {
    _core?: { coreService?: { decPrivateModes?: CursorModes } };
  })._core?.coreService?.decPrivateModes;
  return modes ?? null;
}

/** Smooth short cursor hides while painting every output frame immediately. */
export function smoothTerminalCursorRepaints(term: Terminal, paneId?: string): () => void {
  // Keep renderer-version access here, after the terminal has been opened.
  const core = (term as unknown as {
    _core?: { coreService?: { isCursorHidden: boolean };
      _renderService?: { _renderRows: (start: number, end: number) => void } };
  })._core;
  const service = core?._renderService;
  const cursor = core?.coreService;
  if (!service || !cursor || typeof service._renderRows !== 'function') return () => {};
  const renderRows = service._renderRows;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let smoothed = false;
  let paintedRow = 0;
  let cols = term.cols;
  let rows = term.rows;
  const release = (reason: string) => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    if (isTerminalInputTraceEnabled()) {
      terminalDebug('terminal-cursor-repaint-release', { paneId, reason, smoothed });
    }
    if (smoothed) {
      smoothed = false;
      // Show sequences already refresh their dirty rows through the parser.
      // Only the timeout needs its own cursor repaint, never a full viewport.
      if (reason === 'timeout') {
        const buffer = term.buffer.active;
        const row = Math.max(0, Math.min(term.rows - 1, buffer.cursorY + buffer.baseY - buffer.viewportY));
        term.refresh(Math.min(paintedRow, row), Math.max(paintedRow, row));
      }
    }
  };
  const wrappedRender = (start: number, end: number) => {
    if (timer !== undefined && cursor.isCursorHidden && term.buffer.active.type === 'normal'
      && cols === term.cols && rows === term.rows) {
      smoothed = true;
      const buffer = term.buffer.active;
      paintedRow = Math.max(0, Math.min(term.rows - 1, buffer.cursorY + buffer.baseY - buffer.viewportY));
      // Only the synchronous paint sees a visible cursor. Parsing, queries and
      // later output keep the program's actual state, and text never waits.
      cursor.isCursorHidden = false;
      try {
        renderRows.call(service, start, end);
      } finally {
        cursor.isCursorHidden = true;
      }
      return;
    }
    if (timer !== undefined) {
      // A reset, buffer switch or resize must repaint even without a show sequence.
      const full = smoothed;
      release('surface-change');
      if (full) { start = 0; end = term.rows - 1; }
    }
    renderRows.call(service, start, end);
  };
  service._renderRows = wrappedRender;
  const hide = term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
    if (params.includes(25) && !cursor.isCursorHidden && timer === undefined && term.buffer.active.type === 'normal') {
      cols = term.cols;
      rows = term.rows;
      // Do not extend this deadline: persistent hiding and sustained output must still paint.
      timer = setTimeout(() => release('timeout'), 100);
    }
    return false;
  });
  const show = term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
    if (params.includes(25)) release('show');
    return false;
  });
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    hide.dispose();
    show.dispose();
    if (service._renderRows === wrappedRender) service._renderRows = renderRows;
  };
}

/**
 * Apply a program's requested cursor shape without letting it override the
 * blink preference.
 *
 * Programs select a cursor style with DECSCUSR (`CSI Ps SP q`). xterm keeps
 * that request ahead of `cursorBlink`, so an odd parameter (a blinking style)
 * would blink even when the preference is off, and each redraw restarts the
 * animation as a visible flash while typing. Consume the sequence here, store
 * only its shape in the terminal's cursor mode, and leave blinking to the
 * shared typography preference.
 */
export function applyTerminalCursorPreference(term: Terminal, paneId?: string): void {
  let visibilityChanged = false;
  for (const final of ['h', 'l']) {
    term.parser.registerCsiHandler({ prefix: '?', final }, params => {
      if (params.includes(25)) {
        visibilityChanged = true;
        if (isTerminalInputTraceEnabled()) {
          terminalDebug('terminal-cursor-visibility-request', { paneId, visible: final === 'h' });
        }
      }
      // Observe visibility requests without changing their native parsing or other modes.
      return false;
    });
  }
  term.onRender?.(() => {
    if (!visibilityChanged) return;
    visibilityChanged = false;
    if (!isTerminalInputTraceEnabled()) return;
    const core = (term as unknown as {
      _core?: { coreService?: { isCursorHidden?: boolean } };
    })._core?.coreService;
    const modes = cursorModes(term);
    terminalDebug('terminal-cursor-visibility-render', { paneId, hidden: core?.isCursorHidden,
      blink: modes?.cursorBlink ?? term.options.cursorBlink, shape: modes?.cursorStyle ?? term.options.cursorStyle,
      buffer: term.buffer.active.type, column: term.buffer.active.cursorX, row: term.buffer.active.cursorY });
  });
  term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, params => {
    const first = params[0];
    const value = (typeof first === 'number' ? first : first?.[0]) ?? 1;
    const shape = CURSOR_SHAPES[value];
    const modes = cursorModes(term);
    if (modes) {
      // Parameter 0 resets the shape to the terminal default, like a full reset.
      if (value === 0) modes.cursorStyle = undefined;
      else if (shape) modes.cursorStyle = shape;
      modes.cursorBlink = undefined;
    } else if (value === 0) {
      term.options.cursorStyle = 'block';
    } else if (shape) {
      term.options.cursorStyle = shape;
    }
    return true;
  });
}
