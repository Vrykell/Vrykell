import { convertFileSrc } from '@tauri-apps/api/core';

export const wallpaperExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'];

/** Reject unsupported paths, then decode the actual image before persisting a wallpaper. */
export async function isWallpaperImage(path: string): Promise<boolean> {
  if (!wallpaperExtensions.includes(path.split('.').pop()?.toLowerCase() ?? '')) return false;
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
    try { image.src = convertFileSrc(path); } catch { finish(false); }
  });
}
