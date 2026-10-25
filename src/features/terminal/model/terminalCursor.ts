import type { Terminal } from '@xterm/xterm';

const CURSOR_SHAPES: Record<number, 'block' | 'underline' | 'bar'> = {
  1: 'block',
  2: 'block',
  3: 'underline',
  4: 'underline',
  5: 'bar',
  6: 'bar',
};

/**
 * Apply a program's requested cursor shape without letting it override the
 * blink preference.
 *
 * Programs select a cursor style with DECSCUSR (`CSI Ps SP q`). xterm keeps
 * that request ahead of `cursorBlink`, so an odd parameter (a blinking style)
 * would blink even when the preference is off, and each redraw restarts the
 * animation as a visible flash while typing. Consume the sequence here, copy
 * only its shape into the terminal option, and leave blinking to the shared
 * typography preference.
 */
export function applyTerminalCursorPreference(term: Terminal): void {
  term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, params => {
    const first = params[0];
    const value = (typeof first === 'number' ? first : first?.[0]) ?? 1;
    // Parameter 0 restores the terminal default, which is a block cursor.
    const shape = value === 0 ? 'block' : CURSOR_SHAPES[value] ?? null;
    if (shape) term.options.cursorStyle = shape;
    return true;
  });
}
