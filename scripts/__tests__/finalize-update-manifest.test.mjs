import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeUpdateManifest } from '../finalize-update-manifest.mjs';

const tag = 'v1.2.3';
const assets = ['windows-x86_64', 'linux-x86_64', 'darwin-aarch64', 'darwin-x86_64'].map((platform, index) => ({ id: index + 1, name: `${platform}.bundle` }));
const manifest = { version: '1.2.3', platforms: Object.fromEntries(assets.map(asset => [asset.name.slice(0, -7), {
  url: `https://api.github.com/repos/Vrykell/Vrykell/releases/assets/${asset.id}`, signature: 'a'.repeat(100),
}])) };

test('replaces draft asset endpoints with public download links without changing signatures', () => {
  const result = finalizeUpdateManifest(manifest, tag, assets);
  assert.equal(result.platforms['windows-x86_64'].url, `https://github.com/Vrykell/Vrykell/releases/download/${tag}/windows-x86_64.bundle`);
  assert.equal(result.platforms['windows-x86_64'].signature, manifest.platforms['windows-x86_64'].signature);
  assert.deepEqual(finalizeUpdateManifest(result, tag, assets), result);
  assert.match(manifest.platforms['windows-x86_64'].url, /^https:\/\/api\./);
});

test('rejects missing, foreign or unsafe assets and incomplete platforms', () => {
  assert.throws(() => finalizeUpdateManifest(manifest, tag, assets.slice(1)));
  assert.throws(() => finalizeUpdateManifest(manifest, tag, assets.map(asset => ({ ...asset, name: '../bundle' }))));
  const platforms = { ...manifest.platforms, 'windows-x86_64': { ...manifest.platforms['windows-x86_64'], url: 'https://example.com/update' } };
  assert.throws(() => finalizeUpdateManifest({ ...manifest, platforms }, tag, assets));
  assert.throws(() => finalizeUpdateManifest({ ...manifest, platforms: {} }, tag, assets));
});
