/** Native window borders use the theme's neutral gray divider color. */
import { invoke } from '@platform/diagnostics';
import { Effect, getCurrentWindow } from '@tauri-apps/api/window';
import { isWindows } from './runtime';
import type { ThemeMode } from '@config/theme/tokens';

let materialUpdate = Promise.resolve();
let materialRevision = 0;

/** Serialize native material changes so a late update cannot undo the user's last choice. */
export function syncWindowMaterial(enabled: boolean, mode: ThemeMode): Promise<void> {
  const revision = ++materialRevision;
  materialUpdate = materialUpdate.then(async () => {
    if (!isWindows || revision !== materialRevision) return;
    try {
      const window = getCurrentWindow();
      await window.setTheme(mode);
      // Remove a previously selected material before applying the live translucent backdrop.
      await window.clearEffects();
      if (enabled) await window.setEffects({ effects: [Effect.Acrylic] });
      syncWindowFrame();
    } catch { /* Unsupported compositors keep the CSS navigation treatment. */ }
  });
  return materialUpdate;
}

/** Apply the shared gray border to every window; unsupported frames keep their previous color. */
export function syncWindowFrame(): void {
  const root = document.documentElement;
  const variable = '--border-strong';
  const color = root.style.getPropertyValue(variable).trim()
    || getComputedStyle(root).getPropertyValue(variable).trim();
  if (!color) return;
  void invoke('apply_window_frame', { color }).catch(() => {});
}
