import { getFocusedTerminalId, termInstances } from '../stores/terminal';
import { getExecutingTerm } from '../hooks/useTerminalSession';
import { applyTerminalRenderer } from '../model/xtermRenderer';
import { repaintTerminal } from '../model/terminalResize';
import { useTypographyStore } from '@config/typography';
import { terminalDebug } from './terminalDebug';

/** Rebuild drawing surfaces from existing buffers without restarting the session. */
export function redrawTerminal(paneId = getFocusedTerminalId()): void {
  const terminals = new Set([termInstances.get(paneId), getExecutingTerm(paneId)?.term]);
  let surfaces = 0;
  for (const term of terminals) {
    if (!term?.element) continue;
    applyTerminalRenderer(term, 'dom');
    applyTerminalRenderer(term, useTypographyStore.getState().terminalRenderer);
    repaintTerminal(term);
    surfaces++;
  }
  terminalDebug('terminal-manual-repaint', { paneId, surfaces });
}
