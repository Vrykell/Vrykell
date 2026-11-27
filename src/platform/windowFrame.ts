import { invoke } from '@platform/diagnostics';
import { Effect, getCurrentWindow } from '@tauri-apps/api/window';
import { isMacOS, isWindows, supportsNativeMaterial } from './runtime';
import type { ThemeMode } from '@config/theme/tokens';

let materialUpdate = Promise.resolve();
let materialRevision = 0;

/** Serialize native material changes so a late update cannot undo the user's last choice. */
export function syncWindowMaterial(enabled: boolean, mode: ThemeMode): Promise<void> {
  const revision = ++materialRevision;
  materialUpdate = materialUpdate.then(async () => {
    if (revision !== materialRevision) return;
    const root = document.documentElement;
    root.dataset.nativeMaterial = enabled ? 'fallback' : 'off';
    if (!supportsNativeMaterial) return;
    try {
      const window = getCurrentWindow();
      await window.setTheme(mode);
      // Remove a previously selected material before applying the live translucent backdrop.
      await window.clearEffects();
      if (enabled) await window.setEffects({ effects: [isMacOS ? Effect.Sidebar : Effect.Acrylic] });
      if (revision === materialRevision) root.dataset.nativeMaterial = enabled ? 'active' : 'off';
    } catch {
      /* Unsupported compositors keep the CSS navigation treatment. */
    }
    if (revision === materialRevision) await syncWindowFrame();
  });
  return materialUpdate;
}

/** Keep a single perimeter and allow the compositor to track window activation. */
export async function syncWindowFrame(): Promise<void> {
  if (!isWindows || document.documentElement.dataset.nativeFrame === 'active') return;
  try {
    await invoke('apply_window_frame');
    document.documentElement.dataset.nativeFrame = 'active';
  } catch {
    delete document.documentElement.dataset.nativeFrame;
  }
}
