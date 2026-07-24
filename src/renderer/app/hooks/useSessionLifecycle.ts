import { useCallback } from 'react';
import { createPTY } from '@api';
import { useTerminalStore } from '@renderer/stores/terminal-store';
import { getCharWidth } from '../../features/terminal/engine/char-width';

/**
 * Session creation lifecycle.
 *
 * Estimates dimensions for the initial PTY so it doesn't render at default
 * 80×24 when the actual display area is narrower (due to AI sidebar).
 * The ResizeObserver in the terminal view fine-tunes dimensions after mount.
 */
export function useSessionLifecycle() {
  const addSession = useTerminalStore((s) => s.addSession);

  const createAndAddSession = useCallback(() => {
    // Sidebar starts collapsed — only subtract its width when actually open,
    // otherwise the first frame renders ~40 cols too narrow and the
    // SIGWINCH repaint leaves transitional artifacts.
    const sidebarW = useTerminalStore.getState().sidebarOpen ? 390 : 20;
    const terminalW = window.innerWidth - sidebarW;
    const terminalH = window.innerHeight - 100; // tab bar + status bar
    const cols = Math.max(10, Math.floor(terminalW / getCharWidth()));
    const rows = Math.max(4, Math.floor(terminalH / 16));
    return createPTY({ cols, rows })
      .then((s) => addSession(s))
      .catch((err) => console.error('createPTY failed:', err));
  }, [addSession]);

  return { createAndAddSession };
}
