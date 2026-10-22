import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

let windowCounter = 0;

/** Open another application window with the same persisted workspace settings. */
export function openAppWindow(): WebviewWindow {
  const label = `app-${Date.now().toString(36)}-${windowCounter++}`;
  return new WebviewWindow(label, {
    url: `${window.location.pathname}${window.location.search}`,
    title: 'Vrykell',
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
  });
}
