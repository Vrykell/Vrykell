import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseVersion, validateUpdateManifest } from '../validate-update-release.mjs';

test('only aligned stable application versions can enter the release workflow', () => {
  assert.equal(validateReleaseVersion('v1.2.3', ['1.2.3', '1.2.3', '1.2.3']), '1.2.3');
  for (const tag of ['v1.2.3-beta.1', 'v01.2.3', '1.2.3', 'v1.2.3; echo fixture']) assert.throws(() => validateReleaseVersion(tag, ['1.2.3']));
  assert.throws(() => validateReleaseVersion('v1.2.3', ['1.2.2']));
});

test('a complete signed manifest is required before publication', () => {
  const platforms = Object.fromEntries(['windows-x86_64', 'linux-x86_64', 'darwin-aarch64', 'darwin-x86_64'].map(platform => [platform, { url: `https://github.com/Vrykell/Vrykell/releases/download/v1.2.3/${platform}.bundle`, signature: 'a'.repeat(100) }]));
  const manifest = { version: '1.2.3', platforms };
  validateUpdateManifest(manifest, 'v1.2.3');
  assert.throws(() => validateUpdateManifest({ ...manifest, platforms: {} }, 'v1.2.3'));
  assert.throws(() => validateUpdateManifest({ ...manifest, version: '1.2.3-beta.1' }, 'v1.2.3'));
  for (const url of ['http://github.com/Vrykell/Vrykell/releases/download/v1.2.3/update', 'https://example.com/update', 'https://github.com/other/repo/releases/download/v1.2.3/update']) {
    assert.throws(() => validateUpdateManifest({ ...manifest, platforms: { ...platforms, 'windows-x86_64': { ...platforms['windows-x86_64'], url } } }, 'v1.2.3'));
  }
});
