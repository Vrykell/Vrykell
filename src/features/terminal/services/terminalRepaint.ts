import { getFocusedTerminalId, termInstances } from '../stores/terminal';
import { applyTerminalRenderer } from '../model/xtermRenderer';
import { repaintTerminal } from '../model/terminalResize';
import { useTypographyStore } from '@config/typography';
import { terminalDebug } from './terminalDebug';
import type { Terminal } from '@xterm/xterm';

/**
 * Live running-block terminals, one per pane. The session controller creates them with the block
 * and disposes them with it; they are a second kind of drawing surface next to the pane
 * terminals in {@link termInstances}, and every app-wide drawing operation has to cover both.
 */
const blockTerminals = new Map<string, Terminal>();

export function registerBlockTerminal(paneId: string, term: Terminal): void {
  blockTerminals.set(paneId, term);
}

export function unregisterBlockTerminal(paneId: string, term: Terminal): void {
  if (blockTerminals.get(paneId) === term) blockTerminals.delete(paneId);
}

/** The pane's live block terminal, or null when no command is running on it. */
export function blockTerminalFor(paneId: string): Terminal | null {
  return blockTerminals.get(paneId) ?? null;
}

/** Every live terminal surface: pane terminals plus running-block terminals. */
function liveTerminals(): Terminal[] {
  const terms = new Set<Terminal>(termInstances.values());
  for (const term of blockTerminals.values()) terms.add(term);
  return [...terms].filter((term) => term.element);
}

/** The pane's own surfaces: its terminal plus, while a command runs, its block terminal. */
function paneTerminals(paneId: string): Terminal[] {
  const pane = termInstances.get(paneId);
  const block = blockTerminalFor(paneId);
  return [pane, block].filter((term): term is Terminal => Boolean(term?.element));
}

/** Why the drawing surfaces were rebuilt (diagnostics record). */
export type TerminalSurfaceResetReason = 'manual' | 'window-restore';

/**
 * Rebuild the drawing surfaces of every live terminal from its buffer.
 *
 * Every WebGL terminal with the same font, theme and device pixel ratio shares one glyph atlas
 * (the renderer caches them by config), so clearing it is an app-wide operation: clear once, then
 * rebuild every live terminal so that none of them keeps texture coordinates into the emptied
 * pages. A manual redraw additionally rebuilds the renderer of the pane it was invoked on, which
 * is what makes it the escape hatch for a renderer that misbehaves.
 */
function resetTerminalSurfaces(reason: TerminalSurfaceResetReason, paneId?: string): void {
  const preference = useTypographyStore.getState().terminalRenderer;
  let rendererRebuilds = 0;
  for (const term of paneId ? paneTerminals(paneId) : []) {
    applyTerminalRenderer(term, 'dom');
    applyTerminalRenderer(term, preference);
    rendererRebuilds += 1;
  }
  const terminals = liveTerminals();
  if (!paneId) {
    // A window that comes back may have lost GPU contexts while it was hidden: re-attach the
    // renderer the preference asks for before the repaint.
    for (const term of terminals) applyTerminalRenderer(term, preference);
  }
  // One wipe of the shared atlas, then every surface rebuilds from its buffer.
  terminals[0]?.clearTextureAtlas?.();
  for (const term of terminals) repaintTerminal(term);
  terminalDebug('terminal-atlas-reset', {
    reason,
    paneId: paneId ?? null,
    rendererRebuilds,
    terminals: terminals.length,
  });
}

let resetQueued = false;

/**
 * Rebuild every drawing surface after the window was hidden and came back.
 *
 * Each terminal reports the event on its own, but the reset is shared: without coalescing, every
 * listener would clear the atlas again and rebuild every surface again. A reset that fails must
 * not close the latch for the rest of the session, so the failure is recorded and recovery stays
 * available for the next event.
 */
export function recoverTerminalSurfaces(reason: TerminalSurfaceResetReason = 'window-restore'): void {
  if (resetQueued) return;
  resetQueued = true;
  queueMicrotask(() => {
    resetQueued = false;
    try {
      resetTerminalSurfaces(reason);
    } catch (error) {
      terminalDebug('terminal-surface-reset-error', {
        reason,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  });
}

/** Rebuild the drawing surfaces of a pane without restarting its session or losing its buffer. */
export function redrawTerminal(paneId = getFocusedTerminalId()): void {
  const activeElement = document.activeElement;
  const focused = paneTerminals(paneId)
    .find(term => term.element?.querySelector('.xterm-helper-textarea') === activeElement);
  resetTerminalSurfaces('manual', paneId);
  focused?.focus();
}
