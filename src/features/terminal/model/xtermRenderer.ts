import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalRenderer } from '@config/typography';
import { terminalDebug } from '../services/terminalDebug';

/** Live WebGL addons, so a preference change can be applied to an existing terminal. */
const webglAddons = new WeakMap<Terminal, WebglAddon>();

/** How many GPU contexts the app has handed back, for the diagnostics record. */
let releasedContexts = 0;

/**
 * Dispose a WebGL addon and release its GPU context.
 *
 * The addon's own dispose handler removes the canvas and drops the atlas reference but keeps the
 * WebGL2 context alive. A browser allows only a small number of live contexts per document and
 * drops the oldest live one once that cap is exceeded, which leaves a terminal nobody touched
 * blank or garbled. Every renderer rebuild would otherwise burn one context - the redraw action,
 * a renderer preference change and a running block that ends all rebuild renderers - so the app
 * hands each context back explicitly. The extension is optional, and a context that is already
 * gone is left alone.
 */
function disposeWebglRenderer(term: Terminal, addon: WebglAddon): void {
  webglAddons.delete(term);
  // Read the context before dispose tears the renderer down.
  const gl = (addon as unknown as { _renderer?: { _gl?: WebGL2RenderingContext } })._renderer?._gl;
  addon.dispose();
  try {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // A lost or already released context cannot be handed back again.
  }
  releasedContexts += 1;
  terminalDebug('terminal-webgl-context-released', { released: releasedContexts });
}

/**
 * Load the WebGL renderer, and step down to the DOM renderer when its GPU context is lost.
 *
 * The WebGL renderer addon does not recover by itself: once `onContextLoss` fires it keeps the
 * dead canvas and the terminal stops repainting, so typing looks unresponsive even though the
 * input still reaches the PTY. Disposing the addon is the documented fallback - its dispose
 * handler reinstalls the DOM renderer and re-lays out the screen, so the terminal keeps working
 * (just slower) instead of freezing.
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
      // A lost context is a silent step down to the DOM renderer unless something re-attaches
      // later; the marker keeps the loss itself in the record, apart from an ordinary release.
      terminalDebug('terminal-webgl-context-lost', { released: releasedContexts, attached: Boolean(term.element) });
      disposeWebglRenderer(term, addon);
    });
    webglAddons.set(term, addon);
    term.loadAddon(addon);
  } catch {
    // No WebGL here: stay on the default DOM renderer.
    webglAddons.delete(term);
  }
}

/** Whether the terminal currently draws through the WebGL addon; false means the DOM renderer. */
export function hasWebglRenderer(term: Terminal): boolean {
  return webglAddons.has(term);
}

/** Apply a changed preference to an already open terminal: DOM drops the addon, WebGL loads it. */
export function applyTerminalRenderer(term: Terminal, preference: TerminalRenderer): void {
  const addon = webglAddons.get(term);
  if (preference === 'dom') {
    if (addon) disposeWebglRenderer(term, addon);
    return;
  }
  if (!addon) loadWebglRenderer(term, preference);
}

/**
 * Release the GPU context of a terminal that is about to be disposed.
 * Terminals dispose their addons themselves, which drops the canvas but not the context.
 */
export function releaseTerminalRenderer(term: Terminal): void {
  const addon = webglAddons.get(term);
  if (addon) disposeWebglRenderer(term, addon);
}
