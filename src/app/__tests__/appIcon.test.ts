import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

it('keeps the browser favicon in sync with the desktop icon source', () => {
  const source = read('../../../src-tauri/icons/icon.svg');
  expect(read('../../../public/app-icon.svg')).toBe(source);
  expect(read('../../../index.html')).toContain('href="/app-icon.svg"');
});
