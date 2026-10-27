import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const directory = resolve(process.cwd(), 'public/fonts');

it('distributes all local font assets with licenses and stays below the size budget', () => {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')) as {
    assets: { file: string; bytes: number; sha256: string }[];
  };
  expect(manifest.assets.map(asset => asset.file).sort()).toEqual(['terminal-alternate.woff2', 'terminal-bold.woff2', 'terminal-code.woff2', 'terminal-regular.woff2', 'ui-alternate.woff2', 'ui-sans.woff2']);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(resolve(directory, asset.file));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  }
  const total = readdirSync(directory).reduce((sum, file) => sum + statSync(resolve(directory, file)).size, 0);
  expect(total).toBeLessThan(30_000_000);
  for (const file of ['ui-OFL.txt', 'terminal-OFL.txt', 'code-OFL.txt', 'alternate-OFL.txt', 'interface-alt-OFL.txt']) {
    expect(readFileSync(resolve(directory, file), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  }
});
