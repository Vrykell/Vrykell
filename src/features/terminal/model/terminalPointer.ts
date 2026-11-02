import type { Terminal } from '@xterm/xterm';
import { terminalDebug } from '../services/terminalDebug';

/** Keep passive hover work and pointer visibility stable throughout a typing burst. */
export function configureTerminalPointer(term: Terminal, paneId?: string): () => void {
  const element = term.element;
  if (!element) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressedMoves = 0;
  const restore = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (element.hasAttribute('data-terminal-typing')) {
      element.removeAttribute('data-terminal-typing');
      terminalDebug('terminal-pointer-typing-end', { paneId, suppressedMoves });
      suppressedMoves = 0;
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.target !== term.textarea || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
      || term.modes?.mouseTrackingMode !== 'none'
      || !(event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete')) return;
    if (timer !== undefined) clearTimeout(timer);
    if (!element.hasAttribute('data-terminal-typing')) element.setAttribute('data-terminal-typing', 'true');
    timer = setTimeout(restore, 300);
  };
  const mousemove = (event: MouseEvent) => {
    if (timer === undefined) return;
    if (event.buttons || event.ctrlKey || event.altKey || event.metaKey || term.modes?.mouseTrackingMode !== 'none') {
      restore();
      return;
    }
    // Passive hover hit-testing is unnecessary while the keyboard owns this surface.
    // Selection gestures and application mouse reporting always pass through.
    event.stopPropagation();
    suppressedMoves++;
  };
  element.addEventListener('keydown', keydown, true);
  element.addEventListener('mousemove', mousemove, true);
  element.addEventListener('pointerdown', restore, true);
  element.addEventListener('mouseleave', restore);
  element.addEventListener('focusout', restore);
  return () => {
    restore();
    element.removeEventListener('keydown', keydown, true);
    element.removeEventListener('mousemove', mousemove, true);
    element.removeEventListener('pointerdown', restore, true);
    element.removeEventListener('mouseleave', restore);
    element.removeEventListener('focusout', restore);
  };
}
