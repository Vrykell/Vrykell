import { getPaneTerminal } from './terminalClipboard';
import { terminalInputModes } from '../model/terminalInput';
import { terminalDebug } from './terminalDebug';

/** Restore shell input after a remote menu leaves tracking modes enabled, retaining the screen. */
export function resetTerminalInputModes(paneId: string): void {
  const term = getPaneTerminal(paneId);
  if (!term) return;
  terminalDebug('terminal-input-modes-reset', { paneId, ...terminalInputModes(term) });
  term.write('\x1b[?1;9;66;1000;1002;1003;1004;1005;1006;1015;1016l\x1b>', () => {
    if (getPaneTerminal(paneId) !== term) return;
    terminalDebug('terminal-input-modes-restored', { paneId, ...terminalInputModes(term) });
    term.focus();
  });
}
