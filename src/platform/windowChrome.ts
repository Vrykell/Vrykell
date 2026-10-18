/**
 * Native window frame chrome.
 *
 * The desktop window keeps the native frame (for the compositor drop shadow) and is
 * undecorated, so the frame owns the outermost pixel ring of the visible window: Windows 11
 * paints a one pixel border there and rounds its corners, leaving a seam and unpainted
 * corner wedges next to the square application content. The known `DWMWA_COLOR_NONE`
 * sentinel renders as a dark fallback line on some system builds instead of removing the
 * border. The frame is therefore squared off and its border painted in the color of the
 * content that touches it: the chrome color of the main window, the surface color of a
 * tool window.
 */
import { invoke } from '@platform/diagnostics';

/** Tool window content rests on the surface color, main window edges on the chrome color. */
function frameColorVariable(): string {
  return document.documentElement.dataset.toolWindow === 'true' ? '--surface' : '--chrome-bg';
}

/** Match the current window's native frame to its content; purely decorative, failures keep the previous frame. */
export function syncWindowFrame(): void {
  const root = document.documentElement;
  const variable = frameColorVariable();
  const color = root.style.getPropertyValue(variable).trim()
    || getComputedStyle(root).getPropertyValue(variable).trim();
  if (!color) return;
  void invoke('apply_window_frame', { color }).catch(() => {});
}
