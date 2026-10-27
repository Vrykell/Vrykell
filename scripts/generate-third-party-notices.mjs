import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const records = new Map();
const missing = [];
const importedIconCollections = new Set();
const crateNotices = JSON.parse(read(path.join(root, 'licenses/third-party/crate-upstream.json')));
const overrides = {
  '@fluentui/react-icons': ['fluent-icons-MIT.txt', 'MIT', 'https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE'],
  '@ai-sdk/provider-utils': ['ai-sdk-Apache-2.0.txt', 'Apache-2.0', 'https://github.com/vercel/ai/blob/main/LICENSE'],
  '@crabnebula/tauri-plugin-drag': ['drag-MIT.txt', 'MIT', 'https://github.com/crabnebula-dev/drag-rs/blob/v2/LICENSE_MIT'],
  'remark-math': ['remark-math-MIT.txt', 'MIT', 'https://github.com/remarkjs/remark-math/blob/main/license'],
  'rehype-katex': ['remark-math-MIT.txt', 'MIT', 'https://github.com/remarkjs/remark-math/blob/main/license'],
};

function legalFiles(directory) {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name);
    if (!/^(?:licen[cs]es?|copying|copyright|notice|thirdpartynotices)(?:[.\-_]|$)/i.test(name)) return [];
    if (fs.statSync(file).isFile()) return [{ name, text: read(file) }];
    return fs.readdirSync(file).sort().filter(child => fs.statSync(path.join(file, child)).isFile())
      .map(child => ({ name: `${name}/${child}`, text: read(path.join(file, child)) }));
  });
}

function add(record) {
  if (!record.license || record.texts.length === 0) missing.push(record.key);
  records.set(record.key, record);
}

function namedPackage(id) {
  let directory = path.dirname(id.split('?')[0].replace(/^\0/, ''));
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const metadata = JSON.parse(read(manifest));
      if (metadata.name && metadata.version) return { directory, metadata };
    }
    directory = path.dirname(directory);
  }
  return undefined;
}

function addPackage(directory, metadata) {
  const key = `npm:${metadata.name}@${metadata.version}`;
  if (records.has(key)) return;
  const override = overrides[metadata.name];
  const texts = legalFiles(directory);
  if (override) texts.push({ name: override[0], text: read(path.join(root, 'licenses/third-party', override[0])) });
  add({ key, license: metadata.license ?? override?.[1], source: `https://www.npmjs.com/package/${metadata.name}/v/${metadata.version}`,
    noticeSource: override?.[2], texts });
}

await build({ root, logLevel: 'error', build: { write: false, minify: false, reportCompressedSize: false },
  plugins: [{ name: 'distribution-license-inventory', generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk') continue;
      for (const id of Object.keys(chunk.modules)) {
        const collection = /~icons\/([^/]+)/.exec(id)?.[1];
        if (collection) importedIconCollections.add(collection);
        if (!id.includes('node_modules')) continue;
        const found = namedPackage(id);
        if (found) addPackage(found.directory, found.metadata);
      }
    }
  } }],
});

const nativePackages = new Map();
const targets = ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-unknown-linux-gnu'];
for (const target of targets) {
  const result = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', target], {
    cwd: path.join(root, 'src-tauri'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Cannot resolve native licenses for ${target}: ${result.error?.message ?? result.stderr}`);
  for (const item of JSON.parse(result.stdout).packages) if (item.source) nativePackages.set(item.id, item);
}
for (const item of nativePackages.values()) {
  const directory = path.dirname(item.manifest_path);
  const texts = legalFiles(directory);
  let revision;
  try { revision = JSON.parse(read(path.join(directory, '.cargo_vcs_info.json'))).git.sha1; } catch {}
  const upstream = crateNotices.find(notice => notice.names.includes(item.name) && (!notice.revision || notice.revision === revision));
  if (!texts.length && upstream) texts.push({ name: upstream.file, text: read(path.join(root, 'licenses/third-party', upstream.file)) });
  if (!texts.length && item.name === 'selectors') texts.push({ name: 'MPL-2.0.txt', text: read(path.join(root, 'licenses/third-party/MPL-2.0.txt')) });
  if (!texts.length && item.name === 'libappindicator-sys') texts.push({ name: 'indicator-MIT.txt', text: read(path.join(root, 'licenses/third-party/indicator-MIT.txt')) });
  if (item.license_file) {
    const file = path.resolve(directory, item.license_file);
    if (fs.existsSync(file) && !texts.some(text => text.name === path.basename(file))) texts.push({ name: path.basename(file), text: read(file) });
  }
  add({ key: `crate:${item.name}@${item.version}`, license: item.license,
    source: `https://crates.io/api/v1/crates/${item.name}/${item.version}/download`, noticeSource: upstream?.source, texts });
  if (item.name === 'libssh2-sys') add({ key: `native:libssh2 (via ${item.name}@${item.version})`, license: 'BSD-3-Clause',
    source: `https://crates.io/api/v1/crates/${item.name}/${item.version}/download`, texts: [{ name: 'libssh2/COPYING', text: read(path.join(directory, 'libssh2/COPYING')) }] });
  if (item.name === 'openssl-src') add({ key: `native:OpenSSL (via ${item.name}@${item.version})`, license: 'Apache-2.0',
    source: `https://crates.io/api/v1/crates/${item.name}/${item.version}/download`, texts: legalFiles(path.join(directory, 'openssl')) });
}

const assetLicenses = [
  ['icons:devicon and devicon-plain', 'MIT', 'devicon-MIT.txt', 'https://github.com/devicons/devicon/blob/master/LICENSE'],
  ['icons:mdi', 'Apache-2.0', 'material-icons-notice.txt', 'https://github.com/Templarian/MaterialDesign/blob/master/LICENSE'],
  ['icons:codicons', 'CC-BY-4.0', 'codicons-CC-BY-4.0.txt', 'https://github.com/microsoft/vscode-codicons'],
];
for (const collection of importedIconCollections) {
  if (!['devicon', 'devicon-plain', 'mdi'].includes(collection)) throw new Error(`Missing artwork license review for imported icon collection: ${collection}`);
}
for (const [key, license, file, source] of assetLicenses) add({ key, license, source,
  texts: [{ name: file, text: read(path.join(root, 'licenses/third-party', file)) }] });

const fonts = JSON.parse(read(path.join(root, 'public/fonts/manifest.json')));
for (const [key, file, family] of [['ui', 'ui-OFL.txt', 'Noto Sans SC'], ['terminal', 'terminal-OFL.txt', 'Maple Mono NF CN'], ['code', 'code-OFL.txt', 'JetBrains Mono'],
  ['alternate', 'alternate-OFL.txt', 'Cascadia Code'], ['interfaceAlternate', 'interface-alt-OFL.txt', 'Inter']]) {
  add({ key: `font:${family}`, license: 'OFL-1.1', source: fonts.sources[key].url,
    checksum: fonts.sources[key].sha256, texts: [{ name: file, text: read(path.join(root, 'public/fonts', file)) }] });
}

if (missing.length) throw new Error(`Missing license metadata or original notices:\n${missing.sort().join('\n')}`);

const lines = [
  'THIRD-PARTY SOFTWARE AND ASSET NOTICES', '',
  'Generated by npm run licenses:generate from the locked dependency versions.',
  'Original copyright and license texts below are reproduced in their original language.',
  'The project license does not replace the licenses of these components.', '',
  'Scope: frontend output modules; four desktop target dependency graphs, including',
  'build tools; bundled native dependency sources; imported icon sets; bundled fonts.',
  'A listing is conservative and does not imply every listed build dependency is linked.',
  'Covered source packages, including unmodified MPL-2.0 sources, are available at the',
  'exact-version source URLs below. Preserve these notices with redistributed copies.',
  'Platform libraries added by an installer must also be inventoried for that artifact.',
  'SQLite bundled through the native database binding is public domain:',
  'https://www.sqlite.org/copyright.html', '',
  'Project license text (also applicable where a notice references Apache-2.0):', read(path.join(root, 'LICENSE')), '',
  'Attribution: Codicons are by Microsoft and contributors; artwork is CC-BY-4.0.',
  'The icon font is redistributed for embedded editor controls. No artwork changes are',
  'made by this project. Code remains under its separate MIT license.',
  'Brand names and marks identify integrations; no affiliation or endorsement is implied.', '',
];
const blocks = new Map();
for (const record of [...records.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'))) {
  lines.push('='.repeat(78), record.key, `License expression: ${record.license}`, `Source: ${record.source}`);
  if (record.noticeSource) lines.push(`Original notice: ${record.noticeSource}`);
  if (record.checksum) lines.push(`Source SHA-256: ${record.checksum}`);
  for (const text of record.texts) {
    const hash = createHash('sha256').update(text.text).digest('hex');
    const id = `license-text-${hash.slice(0, 16)}`;
    lines.push(`Notice file: ${text.name}`, `License text reference: ${id}`);
    blocks.set(id, text.text);
  }
  lines.push('');
}
for (const [id, text] of [...blocks].sort(([a], [b]) => a.localeCompare(b, 'en'))) lines.push('='.repeat(78), id, '', text, '');
const output = `${lines.join('\n')}\n`;
const destination = path.join(root, 'public/legal/THIRD_PARTY_NOTICES.txt');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || read(destination) !== output.trimEnd()) throw new Error('Third-party notices are stale; run npm run licenses:generate.');
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, output, 'utf8');
}
console.log(`Recorded ${records.size} components and ${blocks.size} original license texts (${Buffer.byteLength(output)} bytes).`);
