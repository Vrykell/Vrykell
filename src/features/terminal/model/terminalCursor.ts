import type { Terminal } from '@xterm/xterm';

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
export function applyTerminalCursorPreference(term: Terminal): void {
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
