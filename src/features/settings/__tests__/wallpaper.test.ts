import { afterEach, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock, diagnostic: vi.fn() }));
vi.mock('@features/terminal/services/terminalDebug', () => ({ terminalDebug: vi.fn() }));

import { isWallpaperImage, wallpaperExtensions } from '../services/wallpaper';

afterEach(() => { invokeMock.mockReset(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('rejects documents and archives without attempting to read them', async () => {
  expect(wallpaperExtensions).not.toContain('pdf');
  for (const path of ['/notes.txt', '/archive.zip', '/fake.png.exe', '/folder']) {
    expect(await isWallpaperImage(path)).toBe(false);
  }
  expect(invokeMock).not.toHaveBeenCalled();
});

it('reads the candidate through the backend and requires a decodable image', async () => {
  let fail = false;
  const sources: string[] = [];
  class ImageStub {
    naturalWidth = 100;
    naturalHeight = 80;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { sources.push(value); queueMicrotask(() => { if (fail) this.onerror?.(); else this.onload?.(); }); }
  }
  vi.stubGlobal('Image', ImageStub);
  invokeMock.mockResolvedValue('data:image/jpeg;base64,AAAA');
  // Uppercase extensions still pass the extension gate; the decode runs on the backend bytes,
  // never on the asset URL, because the file is not authorized before it is saved.
  expect(await isWallpaperImage('/photo.JPG')).toBe(true);
  expect(invokeMock).toHaveBeenCalledWith('read_image_data_url', { path: '/photo.JPG' });
  expect(sources).toEqual(['data:image/jpeg;base64,AAAA']);
  fail = true;
  expect(await isWallpaperImage('/renamed-document.jpg')).toBe(false);
});

it('rejects unreadable files without decoding', async () => {
  const image = vi.fn();
  vi.stubGlobal('Image', image);
  invokeMock.mockRejectedValue(new Error('读取图片失败'));
  expect(await isWallpaperImage('/unavailable.jpg')).toBe(false);
  expect(image).not.toHaveBeenCalled();
});

it('bounds decoding time for oversized images', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', class { src = ''; });
  invokeMock.mockResolvedValue('data:image/png;base64,AAAA');
  const decoding = isWallpaperImage('/huge.jpg');
  await vi.advanceTimersByTimeAsync(5000);
  expect(await decoding).toBe(false);
});
