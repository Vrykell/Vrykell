import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const host = process.env.MIRROR_HOST;
const token = process.env.MIRROR_TOKEN;
if (!['gitee', 'atomgit'].includes(host) || !token) throw new Error('Missing mirror configuration');
const source = JSON.parse(await fs.readFile('release.json', 'utf8'));
if (!/^v\d+\.\d+\.\d+$/.test(source.tagName)) throw new Error('Invalid stable tag');
const body = `${source.body || ''}\n\n## Downloads\n\n${source.assets.map(asset => `- [${asset.name}](https://github.com/Vrykell/Vrykell/releases/download/${source.tagName}/${encodeURIComponent(asset.name)})`).join('\n')}`;
const base = host === 'gitee' ? 'https://gitee.com/api/v5' : 'https://api.atomgit.com/api/v5';
/**
 * Per-attachment ceiling of the mirror host. Gitee rejects larger single attachments, and one
 * rejected file must not strand the rest of the release, so oversized assets are reported and
 * skipped instead of aborting the whole transfer.
 */
const ATTACHMENT_LIMIT_BYTES = host === 'gitee' ? 100 * 1024 * 1024 : Infinity;
const request = async (route, options = {}) => {
  const url = new URL(`${base}/repos/Vrykell/Vrykell${route}`);
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { ...options, headers: { 'PRIVATE-TOKEN': token, ...options.headers }, signal: AbortSignal.timeout(options.method === 'POST' ? 600000 : 120000) });
  if (!response.ok) throw new Error(`${host} API ${response.status} on ${route.split('?')[0]}`);
  return response.json();
};
const transfer = (args) => {
  const result = spawnSync('curl', ['--fail', '--silent', '--show-error', '--connect-timeout', '30', '--max-time', '1200', ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  // Transport errors can contain signed addresses; report only the exit status.
  if (result.error || result.status !== 0) throw new Error(`${host}: attachment transfer failed (${result.status ?? 'spawn'})`);
};
try {
  let releases = await request('/releases?per_page=100');
  let release = releases.find(item => item.tag_name === source.tagName);
  if (!release) release = await request('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tag_name: source.tagName, name: source.name, body, target_commitish: source.targetCommitish,
    ...(host === 'gitee' ? { prerelease: false } : { release_status: 'latest' }),
  }) });
  else await request(`/releases/${host === 'gitee' ? release.id : encodeURIComponent(source.tagName)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: source.name, body,
      ...(host === 'gitee' ? { tag_name: source.tagName, target_commitish: source.targetCommitish, prerelease: false } : {}),
    }),
  });
  if (process.env.MIRROR_METADATA_ONLY === 'true') {
    console.log(`${host}: release metadata and download links updated`);
    process.exit(0);
  }
  let existing = host === 'gitee' ? await request(`/releases/${release.id}/attach_files`) : release.assets || [];
  const skipped = new Set();
  for (const asset of source.assets) {
    if (path.basename(asset.name) !== asset.name) throw new Error('Invalid asset filename');
    if (existing.some(item => item.name === asset.name)) continue;
    if (asset.size > ATTACHMENT_LIMIT_BYTES) {
      // The host refuses this file outright; note it and keep the remaining attachments moving.
      skipped.add(asset.name);
      console.log(`${host}: skipped ${asset.name} (${Math.round(asset.size / 1024 / 1024)} MB exceeds the attachment limit)`);
      continue;
    }
    const bytes = await fs.readFile(path.join('release-assets', asset.name));
    const file = path.join('release-assets', asset.name);
    if (host === 'gitee') {
      if (process.env.MIRROR_USE_CURL === 'true') {
        transfer(['-F', `access_token=${token}`, '-F', `file=@${file}`, `${base}/repos/Vrykell/Vrykell/releases/${release.id}/attach_files`]);
        console.log(`${host}: uploaded ${asset.name}`);
        continue;
      }
      const data = new FormData();
      data.set('file', new Blob([bytes]), asset.name);
      await request(`/releases/${release.id}/attach_files`, { method: 'POST', body: data });
    } else {
      const upload = await request(`/releases/${encodeURIComponent(source.tagName)}/upload_url?file_name=${encodeURIComponent(asset.name)}`);
      const url = new URL(upload.url);
      if (url.protocol !== 'https:') throw new Error('Invalid upload protocol');
      if (process.env.MIRROR_USE_CURL === 'true') {
        transfer(['--request', 'PUT', '--upload-file', file, ...Object.entries(upload.headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`]), url.href]);
        console.log(`${host}: uploaded ${asset.name}`);
        continue;
      }
      const response = await fetch(url, { method: 'PUT', headers: upload.headers, body: bytes, signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error(`${host} upload failed: ${response.status}`);
    }
    console.log(`${host}: uploaded ${asset.name}`);
  }
  releases = await request('/releases?per_page=100');
  release = releases.find(item => item.tag_name === source.tagName);
  existing = host === 'gitee' ? await request(`/releases/${release.id}/attach_files`) : release.assets || [];
  const expected = source.assets.filter(asset => !skipped.has(asset.name));
  if (!expected.every(asset => existing.some(item => item.name === asset.name))) throw new Error(`${host}: missing release attachments`);
  if (skipped.size) console.log(`${host}: verified ${source.tagName}, ${expected.length} attachments (${skipped.size} over the limit)`);
  else console.log(`${host}: verified ${source.tagName}, ${expected.length} attachments`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
