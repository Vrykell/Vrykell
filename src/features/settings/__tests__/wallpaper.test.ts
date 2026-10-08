import { afterEach, expect, it, vi } from 'vitest';
import { isWallpaperImage, wallpaperExtensions } from '../services/wallpaper';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('rejects documents and archives without attempting to load them', async () => {
  const image = vi.fn();
  vi.stubGlobal('Image', image);
  expect(wallpaperExtensions).not.toContain('pdf');
  for (const path of ['/notes.txt', '/archive.zip', '/fake.png.exe', '/folder']) {
    expect(await isWallpaperImage(path)).toBe(false);
  }
  expect(image).not.toHaveBeenCalled();
});

it('requires an actual decodable image, including uppercase file extensions', async () => {
  let fail = false;
  class ImageStub {
    naturalWidth = 100;
    naturalHeight = 80;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_path: string) { queueMicrotask(() => { if (fail) this.onerror?.(); else this.onload?.(); }); }
  }
  vi.stubGlobal('Image', ImageStub);
  expect(await isWallpaperImage('/photo.PNG')).toBe(true);
  fail = true;
  expect(await isWallpaperImage('/renamed-document.png')).toBe(false);
});

it('bounds decoding time for inaccessible files', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', class { src = ''; });
  const decoding = isWallpaperImage('/unavailable.jpg');
  await vi.advanceTimersByTimeAsync(5000);
  expect(await decoding).toBe(false);
});
