import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

it('keeps the browser favicon in sync with the desktop icon source', () => {
  const source = read('../../../src-tauri/icons/icon.svg');
  expect(read('../../../public/app-icon.svg')).toBe(source);
  expect(read('../../../index.html')).toContain('href="/app-icon.svg"');
});

it('keeps the icon decodable as an image: no double hyphen inside comments', () => {
  // An XML comment must not contain '--', and a browser rejects the whole file as an image when
  // one does — the icon then loads with naturalWidth 0 and renders as nothing.
  const source = read('../../../public/app-icon.svg');
  const withoutDelimiters = source.replace(/<!--/g, '').replace(/-->/g, '');
  expect(withoutDelimiters).not.toContain('--');
});
