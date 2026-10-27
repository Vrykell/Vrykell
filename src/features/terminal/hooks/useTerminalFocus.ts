/**
 * Focus scheduling for the block list: while a command runs, the live terminal inside the
 * running block owns the keyboard. Editable targets keep focus, and a pointer press or an
 * active text selection is never interrupted.
 */

import { useEffect } from 'react';
import { termInstances } from '@features/terminal';
import { getExecutingTerm } from '@features/terminal/hooks/useTerminalSession';
import { isTerminalDebugEnabled, terminalDebug } from '@features/terminal/services/terminalDebug';

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/** A drag in progress or a finished text selection must own the pointer/focus, not the terminal. */
const hasTextSelection = (): boolean => {
  const selection = window.getSelection();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
};

/**
 * @param active Enabled only in the block list while a block is executing.
 * @param tabId Pane whose live terminal takes focus.
 */
export function useTerminalFocus(active: boolean, tabId: string): void {
  useEffect(() => {
    if (!active) return;
    const term = getExecutingTerm(tabId)?.term ?? termInstances.get(tabId);
    if (!term) return;
    let lastFocusState = '';
    // While a pointer is held the user may be selecting block text; focusing the terminal
    // mid-drag collapses the browser selection before mouseup.
    let pointerPressed = false;
    const recordFocusState = (state: string, focused: boolean) => {
      if (!isTerminalDebugEnabled() || lastFocusState === state) return;
      lastFocusState = state;
      terminalDebug('terminal-focus', { tabId, state, focused, mounted: Boolean(term.element) });
    };

    // Return focus to the xterm when it falls back to the body (for example after long output
    // hides the input bar); without focus, IME composition and key events have no target.
    const grabIfIdle = () => {
      if (pointerPressed || hasTextSelection()) return;
      const ae = document.activeElement as HTMLElement | null;
      if (!ae || ae === document.body || ae === document.documentElement) {
        if (!term.element) {
          recordFocusState('terminal-not-mounted', false);
          return;
        }
        term.focus();
        const textarea = term.element.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
        const focused = Boolean(textarea && document.activeElement === textarea);
        recordFocusState(focused ? 'focused' : 'focus-not-applied', focused);
      }
    };
    grabIfIdle(); // Place focus now when it is already idle.
    const onFocusOut = () => {
      // focusout and focusin fire back to back; wait one tick for the final target.
      setTimeout(grabIfIdle, 0);
    };
    // Hiding or unmounting the input bar can drop focus without a focusout event; poll slowly.
    const focusPoll = setInterval(grabIfIdle, 500);

    // Clicking empty pane space pre-focuses the xterm; a text selection keeps focus.
    const onClick = (e: MouseEvent) => {
      pointerPressed = false;
      const pane = term.element?.closest('.terminal-pane');
      if (!(e.target instanceof Node) || !(pane?.contains(e.target) || term.element?.contains(e.target))) return;
      if (isEditable(e.target)) return;
      if (hasTextSelection()) return;
      term.focus();
    };
    const onPointerDown = (event: MouseEvent) => { if (event.button === 0) pointerPressed = true; };
    const onPointerUp = () => { pointerPressed = false; };

    window.addEventListener('focusout', onFocusOut);
    window.addEventListener('click', onClick);
    // Capture phase: a child handler calling stopPropagation must not hide the press.
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('mouseup', onPointerUp, true);
    window.addEventListener('blur', onPointerUp);
    return () => {
      clearInterval(focusPoll);
      window.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('click', onClick);
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('mouseup', onPointerUp, true);
      window.removeEventListener('blur', onPointerUp);
    };
  }, [active, tabId]);
}
