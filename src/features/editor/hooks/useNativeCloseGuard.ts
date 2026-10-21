import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { interceptEditorClose } from '@core/editor';
import { diagnostic } from '@platform/diagnostics';
import { useSessionStore } from '@features/workspace';

/** Native titlebar and system-menu requests share the existing unsaved-document guard. */
export function useNativeCloseGuard() {
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let approved = false;
    try {
      const appWindow = getCurrentWindow();
      void appWindow.onCloseRequested(event => {
        diagnostic('window-close-request', { approved });
        if (approved) { approved = false; return; }
        const open = useSessionStore.getState().tabs.flatMap(tab => tab.kind === 'editor' ? tab.files : []);
        if (interceptEditorClose(open, () => { approved = true; void appWindow.close(); })) event.preventDefault();
      }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    } catch { /* Browser previews do not own a native window. */ }
    return () => { disposed = true; stop?.(); };
  }, []);
}
