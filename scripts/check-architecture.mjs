import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const excludedDirectories = new Set(['store', 'entities', 'shared']);
const excludedSuffixes = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];
const forbiddenImports = [
  '/store/workspace',
  '/store/terminal',
  '/store/chat',
  '/store/blocks',
  '/store/input',
  '/store/ui',
  '/store/dock',
  '/store/dockDrag',
];

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...collectFiles(absolute));
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
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes('from ')) return;
    for (const forbiddenImport of forbiddenImports) {
      if (line.includes(forbiddenImport)) {
        violations.push(`${path.relative(process.cwd(), file)}:${index + 1} ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('架构边界检查失败：生产代码不得直接依赖旧 Store，请通过实体或共享公开入口访问。');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('架构边界检查通过：生产代码未直接穿透旧 Store。');
}
