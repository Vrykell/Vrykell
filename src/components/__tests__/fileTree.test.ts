import { describe, it, expect } from 'vitest';
import { sortEntries, flattenVisible } from '@features/files/fileTree';
import type { FsEntry } from '@features/files/fs';

const dir = (name: string): FsEntry => ({ name, path: `/root/${name}`, is_dir: true });
const file = (name: string): FsEntry => ({ name, path: `/root/${name}`, is_dir: false });

describe('sortEntries', () => {
  it('目录在前，同类按名称排序', () => {
    const sorted = sortEntries([file('b.txt'), dir('zeta'), file('a.txt'), dir('alpha')]);
    expect(sorted.map((e) => e.name)).toEqual(['alpha', 'zeta', 'a.txt', 'b.txt']);
  });

  it('不修改原数组', () => {
    const input = [file('b'), file('a')];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(['b', 'a']);
  });
});

describe('flattenVisible', () => {
  const roots = [file('readme.md'), dir('src'), dir('docs')];

  it('无展开时只有根级行，depth=0', () => {
    const rows = flattenVisible(roots, new Set(), {});
    expect(rows.map((r) => r.entry.name)).toEqual(['docs', 'src', 'readme.md']);
    expect(rows.every((r) => r.depth === 0 && !r.expanded && !r.loading)).toBe(true);
  });

  it('展开的目录插入其子行并递增 depth', () => {
    const srcChildren: FsEntry[] = [
      { name: 'main.ts', path: '/root/src/main.ts', is_dir: false },
      { name: 'lib', path: '/root/src/lib', is_dir: true },
    ];
    const rows = flattenVisible(roots, new Set(['/root/src']), { '/root/src': srcChildren });
    expect(rows.map((r) => `${r.depth}:${r.entry.name}`)).toEqual([
      '0:docs',
      '0:src',
      '1:lib',
      '1:main.ts',
      '0:readme.md',
    ]);
  });

  it('支持多级嵌套展开', () => {
    const cache = {
      '/root/src': [{ name: 'lib', path: '/root/src/lib', is_dir: true }],
      '/root/src/lib': [{ name: 'util.ts', path: '/root/src/lib/util.ts', is_dir: false }],
    };
    const rows = flattenVisible(roots, new Set(['/root/src', '/root/src/lib']), cache);
    expect(rows.map((r) => `${r.depth}:${r.entry.name}`)).toEqual([
      '0:docs',
      '0:src',
      '1:lib',
      '2:util.ts',
      '0:readme.md',
    ]);
  });

  it('展开但缓存未到 → loading=true，不拍平子行', () => {
    const rows = flattenVisible(roots, new Set(['/root/src']), {});
    const src = rows.find((r) => r.entry.name === 'src')!;
    expect(src.expanded).toBe(true);
    expect(src.loading).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('文件即使在 expanded 集合中也不展开', () => {
    const rows = flattenVisible(roots, new Set(['/root/readme.md']), {});
    expect(rows.find((r) => r.entry.name === 'readme.md')!.expanded).toBe(false);
  });

  it('已加载的空目录：expanded 且不 loading，无子行', () => {
    const rows = flattenVisible(roots, new Set(['/root/docs']), { '/root/docs': [] });
    const docs = rows.find((r) => r.entry.name === 'docs')!;
    expect(docs.expanded).toBe(true);
    expect(docs.loading).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it('子项路径与祖先重复（自引用 symlink / 后端异常返回）时停止递归，不栈溢出', () => {
    const selfRef: FsEntry[] = [{ name: 'loop', path: '/root/loop', is_dir: true }];
    const rows = flattenVisible(selfRef, new Set(['/root/loop']), { '/root/loop': selfRef });
    // 子行照常渲染，但不再递归深入
    expect(rows.map((r) => `${r.depth}:${r.entry.name}`)).toEqual(['0:loop', '1:loop']);
  });
});
