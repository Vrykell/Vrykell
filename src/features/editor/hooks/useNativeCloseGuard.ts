import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { flushBeforeClose } from '@core/closeFlush';
import { interceptEditorClose } from '@core/editor';
import { diagnostic } from '@platform/diagnostics';
import { useSessionStore } from '@features/workspace';
import { flushEditorChanges } from '@ui/editor/code/pendingChanges';

/** Native titlebar and system-menu requests share the unsaved-document guard and persistence flushes. */
export function useNativeCloseGuard() {
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let approved = false;
    let pendingClose: Promise<void> | null = null;
    try {
      const appWindow = getCurrentWindow();
      void appWindow.onCloseRequested(event => {
        diagnostic('window-close-request', { approved });
        if (approved) { approved = false; return; }
        event.preventDefault();
        flushEditorChanges();
        const open = useSessionStore.getState().tabs.flatMap(tab => tab.kind === 'editor' ? tab.files : []);
        const finish = () => {
          pendingClose ??= flushBeforeClose().finally(() => {
            approved = true;
            pendingClose = null;
            void appWindow.close().catch(() => { approved = false; });
          });
        };
        if (interceptEditorClose(open, finish)) return;
        finish();
      }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    } catch { /* Browser previews do not own a native window. */ }
    return () => { disposed = true; stop?.(); };
  }, []);
}
