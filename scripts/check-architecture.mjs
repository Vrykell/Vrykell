import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const excludedSuffixes = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];
const allowedTopLevel = new Set([
  'main.tsx',
  'vite-env.d.ts',
  'app',
  'assets',
  'config',
  'core',
  'features',
  'i18n',
  'platform',
  'test-utils',
  'ui',
  'utils',
]);
const lowerLayers = new Set(['config', 'core', 'platform', 'ui', 'utils']);
const forbiddenImportPrefixes = [
  '@/entities/',
  '@/shared/',
  '@/widgets/',
  '@entities/',
  '@shared/',
  '@widgets/',
];
const businessImportPrefixes = ['@app/', '@features/', '@/app/', '@/features/'];
const viewForbiddenImports = [
  '@features/agent/stores/',
  '@features/chat/stores/',
  '@features/files/stores/',
  '@features/search/stores/',
  '@features/ssh/stores/',
  '@features/terminal/stores/',
  '@features/workspace/stores/',
];

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !excludedSuffixes.some((suffix) => entry.name.endsWith(suffix))) {
      files.push(absolute);
    }
  }
  return files;
}

const violations = [];
const invokedCommands = new Map();
for (const file of collectFiles(root)) {
  const relativeFile = path.relative(root, file).replaceAll(path.sep, '/');
  if (/^ui\/[^/]+\.(ts|tsx)$/.test(relativeFile)) {
    violations.push(`${relativeFile}: Shared interface sources must live in an owning package`);
  }
  const topLevel = relativeFile.split('/')[0];
  if (!allowedTopLevel.has(topLevel)) {
    violations.push(`${path.relative(process.cwd(), file)}: 顶层目录 ${topLevel}/ 不属于目标架构`);
  }

  const source = fs.readFileSync(file, 'utf8');
  const isView = /(^|\/)(components|pages)\//.test(relativeFile);
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.includes('from ')) return;
    const location = `${path.relative(process.cwd(), file)}:${index + 1} ${line.trim()}`;

    if (forbiddenImportPrefixes.some((prefix) => line.includes(prefix))) {
      violations.push(`${location}\n  旧架构别名已禁止使用`);
    }

    if (topLevel && lowerLayers.has(topLevel) && businessImportPrefixes.some((prefix) => line.includes(prefix))) {
      violations.push(`${location}\n  ${topLevel}/ 不得反向依赖 app/ 或 features/`);
    }

    if (isView && viewForbiddenImports.some((prefix) => line.includes(prefix))) {
      violations.push(`${location}\n  视图层不得直接依赖领域 Store`);
    }
  });

  // Every command name the frontend invokes must exist in the Rust registration list, or the
  // call only fails at runtime (the e2e mock answers unknown commands with null). The scan sees
  // comments too, so a stale name in a comment is reported as well - keep them in sync.
  for (const match of source.matchAll(/\b(?:rawInvoke|invoke)\s*(?:<[^()]*>)?\s*\(\s*(['"`])([^'"`$]+)\1/g)) {
    const name = match[2];
    if (!/^[a-z][a-z0-9_]*$/.test(name)) continue; // plugin commands ("plugin:…") are not app commands
    if (!invokedCommands.has(name)) {
      invokedCommands.set(name, { file: path.relative(process.cwd(), file), line: source.slice(0, match.index).split('\n').length });
    }
  }
}

// The Rust registration list is the single source of truth for the IPC surface.
const libFile = path.resolve(root, '..', 'src-tauri', 'src', 'lib.rs');
const relativeLib = path.relative(process.cwd(), libFile);
const registeredCommands = new Set();
let libSource = '';
try {
  libSource = fs.readFileSync(libFile, 'utf8');
} catch {
  violations.push(`${relativeLib}: 无法读取 Rust 命令注册表`);
}
const handler = libSource.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
if (!handler) {
  violations.push(`${relativeLib}: 未找到 tauri::generate_handler! 注册块`);
} else {
  for (const entry of handler[1].split(',')) {
    const name = entry.trim().split('::').pop();
    if (/^[a-z][a-z0-9_]*$/.test(name)) registeredCommands.add(name);
  }
}

const sharedCommands = JSON.parse(fs.readFileSync(path.join(root, 'core', 'sharedCommands.json'), 'utf8'));
for (const name of sharedCommands) {
  if (!registeredCommands.has(name)) violations.push(`Shared command ${name} is not registered`);
}

for (const [name, site] of invokedCommands) {
  if (!registeredCommands.has(name)) {
    violations.push(`${site.file}:${site.line}\n  IPC 命令 ${name} 未在 lib.rs 的 generate_handler! 中注册`);
  }
}

// Registered but never invoked in src/: dead surface or a dynamic call site to double-check.
const unusedCommands = [...registeredCommands].filter((name) => !invokedCommands.has(name));
if (unusedCommands.length > 0) {
  console.warn(`提示：以下 IPC 命令已注册但 src/ 内没有调用点，请确认是否仍在使用：\n- ${unusedCommands.join('\n- ')}`);
}

if (violations.length > 0) {
  console.error('架构边界检查失败：');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('架构边界检查通过：目标目录、依赖方向、视图边界与 IPC 命令注册表均正常。');
}
