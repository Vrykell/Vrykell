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
for (const file of collectFiles(root)) {
  const relativeFile = path.relative(root, file).replaceAll(path.sep, '/');
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
}

if (violations.length > 0) {
  console.error('架构边界检查失败：');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('架构边界检查通过：目标目录、依赖方向和视图边界均正常。');
}
