import { termInstances, useTerminalStore } from '../stores/terminal';
import { getExecutingTerm } from '../hooks/useTerminalSession';
import { terminalDebug } from './terminalDebug';

function available(element: HTMLElement | null): element is HTMLElement {
  return !!element && element.getClientRects().length > 0 && !element.closest('[inert]')
    && !element.matches(':disabled') && getComputedStyle(element).visibility !== 'hidden';
}

/** Focus the active input after React reveals a session, before the next paint. */
export function focusSessionInput(paneId: string): void {
  const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].find(available);
  if (dialog) {
    if (!dialog.contains(document.activeElement)) {
      const input = [...dialog.querySelectorAll<HTMLElement>('textarea, input, button')].find(available);
      input?.focus({ preventScroll: true });
    }
    return;
  }
  const pane = document.querySelector<HTMLElement>(`[data-testid="pane-${paneId}"]`);
  if (!available(pane)) return;
  const secret = pane.querySelector<HTMLInputElement>('.ssh-auth-response');
  if (available(secret)) { secret.focus({ preventScroll: true }); return; }
  const scene = useTerminalStore.getState().scenes[paneId] ?? 'classic';
  const input = pane.querySelector<HTMLTextAreaElement>('[data-terminal-input]');
  if (scene !== 'altScreen' && useTerminalStore.getState().keyboardTarget === 'input' && available(input)) {
    input.focus({ preventScroll: true });
    return;
  }
  const main = termInstances.get(paneId);
  const live = getExecutingTerm(paneId)?.term;
  const term = scene === 'classic' || main?.buffer.active.type === 'alternate' ? main : live;
  if (term && available(term.textarea ?? null)) {
    term.focus();
    terminalDebug('terminal-tab-focus', { paneId, scene, target: term === main ? 'main' : 'running' });
    return;
  }
  if (available(input)) {
    input.focus({ preventScroll: true });
    terminalDebug('terminal-tab-focus', { paneId, scene, target: 'command' });
  }
}
