import fs from 'node:fs/promises';
import path from 'node:path';

const host = process.env.MIRROR_HOST;
const token = process.env.MIRROR_TOKEN;
if (!['gitee', 'atomgit'].includes(host) || !token) throw new Error('Missing mirror configuration');
const source = JSON.parse(await fs.readFile('release.json', 'utf8'));
if (!/^v\d+\.\d+\.\d+$/.test(source.tagName)) throw new Error('Invalid stable tag');
const base = host === 'gitee' ? 'https://gitee.com/api/v5' : 'https://api.atomgit.com/api/v5';
const request = async (route, options = {}) => {
  const url = new URL(`${base}/repos/Vrykell/Vrykell${route}`);
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { ...options, headers: { 'PRIVATE-TOKEN': token, ...options.headers }, signal: AbortSignal.timeout(options.method === 'POST' ? 600000 : 120000) });
  if (!response.ok) throw new Error(`${host} API ${response.status} on ${route.split('?')[0]}`);
  return response.json();
};
try {
  let releases = await request('/releases?per_page=100');
  let release = releases.find(item => item.tag_name === source.tagName);
  if (!release) release = await request('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tag_name: source.tagName, name: source.name, body: source.body || '', target_commitish: source.targetCommitish,
    ...(host === 'gitee' ? { prerelease: false } : { release_status: 'latest' }),
  }) });
  let existing = host === 'gitee' ? await request(`/releases/${release.id}/attach_files`) : release.assets || [];
  for (const asset of source.assets) {
    if (path.basename(asset.name) !== asset.name) throw new Error('Invalid asset filename');
    if (existing.some(item => item.name === asset.name)) continue;
    const bytes = await fs.readFile(path.join('release-assets', asset.name));
    if (host === 'gitee') {
      const data = new FormData();
      data.set('file', new Blob([bytes]), asset.name);
      await request(`/releases/${release.id}/attach_files`, { method: 'POST', body: data });
    } else {
      const upload = await request(`/releases/${encodeURIComponent(source.tagName)}/upload_url?file_name=${encodeURIComponent(asset.name)}`);
      const url = new URL(upload.url);
      if (url.protocol !== 'https:') throw new Error('Invalid upload protocol');
      const response = await fetch(url, { method: 'PUT', headers: upload.headers, body: bytes, signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error(`${host} upload failed: ${response.status}`);
    }
    console.log(`${host}: uploaded ${asset.name}`);
  }
  releases = await request('/releases?per_page=100');
  release = releases.find(item => item.tag_name === source.tagName);
  existing = host === 'gitee' ? await request(`/releases/${release.id}/attach_files`) : release.assets || [];
  if (!source.assets.every(asset => existing.some(item => item.name === asset.name))) throw new Error(`${host}: missing release attachments`);
  console.log(`${host}: verified ${source.tagName}, ${source.assets.length} attachments`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
