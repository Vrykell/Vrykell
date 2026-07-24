import { useEffect } from 'react';
import { useTerminalStore } from '@renderer/stores/terminal-store';

interface ShortcutHandlers {
  onNewTab: () => void;
  onCloseActiveTab: () => void;
}

/**
 * Global keyboard shortcuts:
 *   Cmd/Ctrl+T       new tab
 *   Cmd/Ctrl+W       close active tab
 *   Cmd/Ctrl+J       toggle AI sidebar
 *   Cmd/Ctrl+Shift+R toggle rich output panel
 */
export function useGlobalShortcuts({ onNewTab, onCloseActiveTab }: ShortcutHandlers) {
  const toggleOutputPanel = useTerminalStore((s) => s.toggleOutputPanel);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      switch (e.key) {
        case 't': e.preventDefault(); onNewTab(); break;
        case 'w': e.preventDefault(); onCloseActiveTab(); break;
        case 'j': e.preventDefault(); useTerminalStore.getState().toggleSidebar(); break;
        case 'r': if (e.shiftKey) { e.preventDefault(); toggleOutputPanel(); } break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNewTab, onCloseActiveTab, toggleOutputPanel]);
}
