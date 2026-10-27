import { afterEach, expect, it, vi } from 'vitest';
import { availableFontFamilies } from '../availableFonts';

afterEach(() => vi.unstubAllGlobals());

it('always offers bundled faces and only offers local faces whose explicit probes load', async () => {
  const load = vi.fn((source: string) => source.includes('Installed Mono') ? Promise.resolve() : Promise.reject(new Error('Unavailable')));
  vi.stubGlobal('FontFace', class {
    constructor(_family: string, private source: string) {}
    load() { return load(this.source); }
  });
  expect(await availableFontFamilies(['Bundled Mono', 'Missing Mono', 'Installed Mono'], ['Bundled Mono'])).toEqual(['Bundled Mono', 'Installed Mono']);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls.every(([source]) => source.startsWith('local('))).toBe(true);
});

it('only offers bundled faces when local font probing is unavailable', async () => {
  vi.stubGlobal('FontFace', undefined);
  expect(await availableFontFamilies(['Missing', 'Bundled'], ['Bundled'])).toEqual(['Bundled']);
});
