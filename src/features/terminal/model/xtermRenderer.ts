import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalRenderer } from '@config/typography';

/** Live WebGL addons, so a preference change can be applied to an existing terminal. */
const webglAddons = new WeakMap<Terminal, WebglAddon>();

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
 * error: the terminal keeps the renderer it already had. Choosing the DOM renderer in settings
 * skips the addon entirely, which some GPU drivers need to keep selection edges clean.
 */
export function loadWebglRenderer(term: Terminal, preference: TerminalRenderer = 'webgl'): void {
  if (preference === 'dom') return;
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      webglAddons.delete(term);
      addon.dispose();
    });
    webglAddons.set(term, addon);
    term.loadAddon(addon);
  } catch {
    // No WebGL here: stay on the default DOM renderer.
    webglAddons.delete(term);
  }
}

/** Apply a changed preference to an already open terminal: DOM drops the addon, WebGL loads it. */
export function applyTerminalRenderer(term: Terminal, preference: TerminalRenderer): void {
  const addon = webglAddons.get(term);
  if (preference === 'dom') {
    if (addon) {
      webglAddons.delete(term);
      addon.dispose();
    }
    return;
  }
  if (!addon) loadWebglRenderer(term, preference);
}
