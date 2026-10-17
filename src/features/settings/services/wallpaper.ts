import { invoke } from '@platform/diagnostics';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

export const wallpaperExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'];

/** Resolve only when the source decodes to an image with real pixel dimensions. */
function decodesAsImage(src: string): Promise<boolean> {
  return new Promise(resolve => {
    const image = new Image();
    const finish = (valid: boolean) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(valid);
    };
    const timeout = setTimeout(() => finish(false), 5000);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = src;
  });
}

/**
 * Reject unsupported paths, then decode the actual image before persisting a wallpaper.
 *
 * The candidate is read through the backend: the asset protocol only serves paths that were
 * authorized when a wallpaper was saved, so a not-yet-saved file would fail to load there
 * and every externally chosen image would be reported as invalid. The data URL only lives
 * for this check; the saved wallpaper is displayed from the authorized asset URL.
 */
export async function isWallpaperImage(path: string): Promise<boolean> {
  if (!wallpaperExtensions.includes(path.split('.').pop()?.toLowerCase() ?? '')) {
    terminalDebug('wallpaper-validation', { result: 'unsupported-extension' });
    return false;
  }
  let dataUrl: string;
  try {
    dataUrl = await invoke<string>('read_image_data_url', { path });
  } catch (error) {
    terminalDebug('wallpaper-validation', {
      result: 'read-failed',
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
  const valid = await decodesAsImage(dataUrl);
  terminalDebug('wallpaper-validation', { result: valid ? 'ok' : 'decode-failed' });
  return valid;
}
