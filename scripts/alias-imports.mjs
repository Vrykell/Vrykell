#!/usr/bin/env node
/**
 * Codemod: 将 src 下跨目录的相对导入（../、../../…）重写为 @/ 别名导入。
 * 同目录 ./ 导入保持不变（同目录文件移动时一起走，语义更清晰）。
 *
 * 规则：
 *   ../../lib/pty   → @/lib/pty
 *   ../stores/ui    → @/stores/ui
 *   ./Foo           → ./Foo（不动）
 *   @/x             → @/x（幂等）
 *
 * 用法：node scripts/alias-imports.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');

// 收集所有 .ts/.tsx 文件
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** 把一个相对 spec 转成 @/ 形式；不适用时返回 null */
function toAlias(spec, fromFile) {
  if (!spec.startsWith('.')) return null; // 已是别名或包名
  const abs = resolve(dirname(fromFile), spec);
  if (!abs.startsWith(SRC + sep)) return null; // 越出 src（不应出现）
  return '@/' + abs.slice(SRC.length + sep.length).split(sep).join('/');
}

const IMPORT_RE = /(from\s+|import\s+|import\(?)['"]([^'"]+)['"]/g;

const files = walk(SRC);
let touched = 0;
let rewritten = 0;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(IMPORT_RE, (m, prefix, spec) => {
    const alias = toAlias(spec, file);
    if (!alias || alias === spec) return m;
    rewritten++;
    return `${prefix}'${alias}'`;
  });
  if (after !== before) {
    writeFileSync(file, after);
    touched++;
    console.log(`rewrote ${file.slice(SRC.length + sep.length)}`);
  }
}

console.log(`\n${touched} files changed, ${rewritten} imports rewritten.`);
