import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('creates both mirror releases, uploads binaries and verifies attachment membership', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'release-mirror-test-'));
  const original = { cwd: process.cwd(), fetch: globalThis.fetch, host: process.env.MIRROR_HOST, token: process.env.MIRROR_TOKEN };
  try {
    await fs.mkdir(path.join(directory, 'release-assets'));
    await fs.writeFile(path.join(directory, 'release-assets', 'portable.zip'), 'archive');
    await fs.writeFile(path.join(directory, 'release.json'), JSON.stringify({ tagName: 'v0.1.9', name: 'Release', body: 'Changes', targetCommitish: 'abc', assets: [{ name: 'portable.zip' }] }));
    process.chdir(directory);
    process.env.MIRROR_TOKEN = 'fixture-token';
    for (const host of ['gitee', 'atomgit']) {
      process.env.MIRROR_HOST = host;
      let release;
      const assets = [];
      globalThis.fetch = async (input, options = {}) => {
        const url = new URL(input);
        if (url.hostname === 'storage.example') {
          assert.equal(options.method, 'PUT');
          assert.equal(Buffer.from(options.body).toString(), 'archive');
          assets.push({ name: 'portable.zip' });
          return new Response('{}');
        }
        assert.equal(url.searchParams.get('access_token'), 'fixture-token');
        if (options.method === 'PATCH') {
          const body = JSON.parse(options.body);
          if (host === 'gitee') assert.equal(body.tag_name, 'v0.1.9');
          assert.match(body.body, /portable.zip/);
          return Response.json(release);
        }
        if (url.pathname.endsWith('/upload_url')) return Response.json({ url: 'https://storage.example/upload', headers: {} });
        if (url.pathname.endsWith('/attach_files')) {
          if (options.method === 'POST') {
            assert.equal(options.body.get('file').name, 'portable.zip');
            assets.push({ name: 'portable.zip' });
          }
          return Response.json(assets);
        }
        if (options.method === 'POST') {
          const body = JSON.parse(options.body);
          assert.equal(body.target_commitish, 'abc');
          assert.match(body.body, /https:\/\/github.com\/Vrykell\/Vrykell\/releases\/download\/v0.1.9\/portable.zip/);
          assert.equal(host === 'atomgit' ? body.release_status : body.prerelease, host === 'atomgit' ? 'latest' : false);
          release = { ...body, id: 1, assets };
          return Response.json(release);
        }
        return Response.json(release ? [release] : []);
      };
      await import(`../mirror-release.mjs?fixture=${host}`);
      await import(`../mirror-release.mjs?fixture=${host}-retry`);
      assert.deepEqual(assets, [{ name: 'portable.zip' }]);
    }
  } finally {
    process.chdir(original.cwd);
    globalThis.fetch = original.fetch;
    for (const [name, value] of [['MIRROR_HOST', original.host], ['MIRROR_TOKEN', original.token]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('omits attachments above the host limit instead of stranding the rest of the release', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'release-mirror-limit-'));
  const original = { cwd: process.cwd(), fetch: globalThis.fetch, host: process.env.MIRROR_HOST, token: process.env.MIRROR_TOKEN };
  try {
    await fs.mkdir(path.join(directory, 'release-assets'));
    await fs.writeFile(path.join(directory, 'release-assets', 'small.zip'), 'archive');
    // Gitee refuses single attachments above 100 MB; the oversized image must not block the rest.
    await fs.writeFile(path.join(directory, 'release.json'), JSON.stringify({
      tagName: 'v0.1.10', name: 'Release', body: 'Changes', targetCommitish: 'abc',
      assets: [
        { name: 'huge.AppImage', size: 120 * 1024 * 1024 },
        { name: 'small.zip', size: 1024 },
      ],
    }));
    process.chdir(directory);
    process.env.MIRROR_TOKEN = 'fixture-token';
    process.env.MIRROR_HOST = 'gitee';
    let release;
    const assets = [];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/attach_files')) {
        if (options.method === 'POST') {
          const name = options.body.get('file').name;
          assert.equal(name, 'small.zip');
          assets.push({ name });
        }
        return Response.json(assets);
      }
      if (options.method === 'PATCH') return Response.json(release);
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        release = { ...body, id: 1, assets };
        return Response.json(release);
      }
      return Response.json(release ? [release] : []);
    };
    await import('../mirror-release.mjs?fixture=limit');
    assert.deepEqual(assets, [{ name: 'small.zip' }]);
  } finally {
    process.chdir(original.cwd);
    globalThis.fetch = original.fetch;
    for (const [name, value] of [['MIRROR_HOST', original.host], ['MIRROR_TOKEN', original.token]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
