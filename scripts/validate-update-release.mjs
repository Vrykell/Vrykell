import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateReleaseVersion(tag, versions) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error('A stable vMAJOR.MINOR.PATCH tag is required');
  const version = tag.slice(1);
  if (versions.some(value => value !== version)) throw new Error('Release tag and application versions must match');
  return version;
}

export function validateUpdateManifest(manifest, tag) {
  validateReleaseVersion(tag, [manifest.version]);
  for (const platform of ['windows-x86_64', 'linux-x86_64', 'darwin-aarch64', 'darwin-x86_64']) {
    const artifact = manifest.platforms?.[platform];
    if (!artifact || typeof artifact.signature !== 'string' || artifact.signature.length < 80) throw new Error(`Missing signed update for ${platform}`);
    const url = new URL(artifact.url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/Vrykell/Vrykell/releases/download/${tag}/`)) throw new Error(`Unexpected update URL for ${platform}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tag = process.env.RELEASE_TAG ?? '';
  if (process.argv[2]) validateUpdateManifest(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), tag);
  else {
    const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    const configVersion = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version;
    const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'))?.[1];
    console.log(validateReleaseVersion(tag, [packageVersion, configVersion, cargoVersion]));
  }
}
