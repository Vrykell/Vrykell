import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';

/**
 * Load the WebGL renderer, and step down to the DOM renderer when its GPU context is lost.
 *
 * xterm's WebGL addon does not recover by itself: once `onContextLoss` fires it keeps the dead
 * canvas and the terminal stops repainting, so typing looks unresponsive even though the input
 * still reaches the PTY. Disposing the addon is the documented fallback - its dispose handler
 * reinstalls the DOM renderer and re-lays out the screen, so the terminal keeps working (just
 * slower) instead of freezing.
 *
 * WebGL is also unavailable in some WebViews, which is why a failed construction is not an
 * error: the terminal keeps the renderer it already had.
 */
export function loadWebglRenderer(term: Terminal): void {
  // Diagnostic switch: `localStorage['vrykell-terminal-renderer'] = 'dom'` keeps the DOM
  // renderer for the current profile, so the two renderers can be compared on real content.
  if (globalThis.localStorage?.getItem('vrykell-terminal-renderer') === 'dom') return;
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => addon.dispose());
    term.loadAddon(addon);
  } catch {
    // No WebGL here: stay on the default DOM renderer.
  }
}
