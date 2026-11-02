import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseVersion, validateUpdateManifest } from './validate-update-release.mjs';

const repository = 'Vrykell/Vrykell';

export function finalizeUpdateManifest(manifest, tag, assets) {
  validateReleaseVersion(tag, [manifest.version]);
  const platforms = Object.fromEntries(Object.entries(manifest.platforms ?? {}).map(([platform, update]) => {
    const asset = assets.find(asset => Number.isSafeInteger(asset.id) && asset.id > 0
      && typeof asset.name === 'string' && asset.name.length > 0 && !/[\\/\x00-\x1f\x7f]/.test(asset.name)
      && (update.url === `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`
        || update.url === `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(asset.name)}`));
    if (!asset) throw new Error(`Update asset does not belong to this release: ${platform}`);
    return [platform, { ...update, url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(asset.name)}` }];
  }));
  const result = { ...manifest, platforms };
  validateUpdateManifest(result, tag);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = process.argv[2];
  const release = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const result = finalizeUpdateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), process.env.RELEASE_TAG ?? '', release.assets);
  fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2) + '\n');
}
