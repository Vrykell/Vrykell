import { afterEach, expect, it, vi } from 'vitest';
import { loadBundledFonts } from '../bundledFonts';

afterEach(() => vi.unstubAllGlobals());

it('waits for local interface and terminal faces before measurements begin', async () => {
  let finish: () => void = () => {};
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const load = vi.fn((_font: string, _sample: string) => pending);
  vi.stubGlobal('document', { fonts: { load } });
  let ready = false;
  const loading = loadBundledFonts().then(() => { ready = true; });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(load.mock.calls.map(([font]) => font)).toEqual([
    '400 14px "Noto Sans SC"', '400 14px "Maple Mono NF CN"', '700 14px "Maple Mono NF CN"',
    '400 14px "Cascadia Code"', '400 14px "JetBrains Mono"', '400 14px "Inter"',
  ]);
  finish();
  await loading;
  expect(ready).toBe(true);
});

it('allows startup with fallback fonts when a local face fails', async () => {
  const load = vi.fn().mockRejectedValue(new Error('Font unavailable'));
  vi.stubGlobal('document', { fonts: { load } });
  await expect(loadBundledFonts()).resolves.toBeUndefined();
  expect(load).toHaveBeenCalledTimes(6);
});

it('allows environments without a font loading API', async () => {
  vi.stubGlobal('document', {});
  await expect(loadBundledFonts()).resolves.toBeUndefined();
});
