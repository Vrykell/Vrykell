import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

it('declares the same project license in package metadata and installer resources', () => {
  const frontend = JSON.parse(read('package.json')) as { license: string };
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { license?: string }> };
  const native = read('src-tauri/Cargo.toml');
  const config = JSON.parse(read('src-tauri/tauri.conf.json')) as {
    bundle: { license: string; licenseFile: string; resources: Record<string, string> };
  };
  expect(frontend.license).toBe('Apache-2.0');
  expect(lock.packages[''].license).toBe(frontend.license);
  expect(native).toMatch(/^license = "Apache-2.0"$/m);
  expect(config.bundle.license).toBe(frontend.license);
  expect(config.bundle.licenseFile).toBe('../LICENSE');
  expect(read('LICENSE')).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION');
  expect(read('NOTICE')).toContain('Copyright 2026 Vrykell contributors');
  for (const source of ['../LICENSE', '../NOTICE', '../public/legal/THIRD_PARTY_NOTICES.txt']) {
    expect(existsSync(resolve(root, 'src-tauri', source))).toBe(true);
    expect(config.bundle.resources[source]).toMatch(/^legal\//);
  }
  expect(config.bundle.resources['../public/fonts/*-OFL.txt']).toBe('legal/fonts/');
});

it('ships original license texts, covered source links and asset attribution without local paths', () => {
  const notices = read('public/legal/THIRD_PARTY_NOTICES.txt');
  expect(notices).toContain('crate:option-ext@');
  expect(notices).toContain('https://crates.io/api/v1/crates/option-ext/');
  expect(notices).toContain('License expression: MPL-2.0');
  expect(notices).toContain('icons:codicons');
  expect(notices).toContain('CC-BY-4.0');
  expect(notices).toContain('SIL OPEN FONT LICENSE');
  expect(notices).toContain('MIT License');
  expect(notices).not.toMatch(/[A-Z]:[\\/]Users[\\/]|\/Users\/|\/home\/[^/]+\/(?:\.cargo|node_modules)/i);
  const references = [...notices.matchAll(/^License text reference: (license-text-[a-f0-9]+)$/gm)].map(match => match[1]);
  const blocks = new Set([...notices.matchAll(/^(license-text-[a-f0-9]+)$/gm)].map(match => match[1]));
  expect(references.length).toBeGreaterThan(100);
  for (const reference of references) expect(blocks.has(reference)).toBe(true);
});
