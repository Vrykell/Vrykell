import { useEffect } from 'react';
import { fileDirectoryShortcut } from '@config/fileShortcuts';

export function useFileDirectoryShortcuts(enabled: boolean, terminal?: () => void, panel?: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const action = fileDirectoryShortcut(event);
      if (!action || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-settings-open="true"]')) return;
      const run = action === 'terminal' ? terminal : panel;
      if (!run) return;
      event.preventDefault(); event.stopImmediatePropagation(); run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, terminal, panel]);
}
