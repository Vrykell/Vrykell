import { describe, it, expect } from 'vitest';
import { sortEntries, flattenVisible } from '@features/files/utils/fileTree';
import type { FsEntry } from '@platform/api/types';

const dir = (name: string): FsEntry => ({ name, path: `/root/${name}`, is_dir: true });
const file = (name: string): FsEntry => ({ name, path: `/root/${name}`, is_dir: false });

describe('sortEntries', () => {
  it('directories first, then same-kind entries sorted by name', () => {
    const sorted = sortEntries([file('b.txt'), dir('zeta'), file('a.txt'), dir('alpha')]);
    expect(sorted.map((e) => e.name)).toEqual(['alpha', 'zeta', 'a.txt', 'b.txt']);
  });

  it('does not mutate the input array', () => {
    const input = [file('b'), file('a')];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(['b', 'a']);
  });
});

describe('flattenVisible', () => {
  const roots = [file('readme.md'), dir('src'), dir('docs')];

  it('with nothing expanded, only root rows, depth=0', () => {
    const rows = flattenVisible(roots, new Set(), {});
    expect(rows.map((r) => r.entry.name)).toEqual(['docs', 'src', 'readme.md']);
    expect(rows.every((r) => r.depth === 0 && !r.expanded && !r.loading)).toBe(true);
  });

  it('an expanded directory inserts its child rows and increments depth', () => {
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

  it('supports multiple nested expansion levels', () => {
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

  it('expanded but cache not loaded → loading=true, no child rows flattened', () => {
    const rows = flattenVisible(roots, new Set(['/root/src']), {});
    const src = rows.find((r) => r.entry.name === 'src')!;
    expect(src.expanded).toBe(true);
    expect(src.loading).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('a file never expands even when present in the expanded set', () => {
    const rows = flattenVisible(roots, new Set(['/root/readme.md']), {});
    expect(rows.find((r) => r.entry.name === 'readme.md')!.expanded).toBe(false);
  });

  it('loaded empty directory: expanded and not loading, no child rows', () => {
    const rows = flattenVisible(roots, new Set(['/root/docs']), { '/root/docs': [] });
    const docs = rows.find((r) => r.entry.name === 'docs')!;
    expect(docs.expanded).toBe(true);
    expect(docs.loading).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it('a known-empty directory is marked empty (no expand arrow at the start of the row); unloaded and non-empty directories are not', () => {
    const rows = flattenVisible(roots, new Set(['/root/docs']), { '/root/docs': [] });
    expect(rows.find((r) => r.entry.name === 'docs')!.empty).toBe(true);
    // A directory whose children are not loaded does not know whether to show the arrow, so empty stays false
    expect(rows.find((r) => r.entry.name === 'src')!.empty).toBe(false);
    // Directory with children
    const withChildren = flattenVisible(roots, new Set(), { '/root/src': [{ name: 'lib', path: '/root/src/lib', is_dir: true }] });
    expect(withChildren.find((r) => r.entry.name === 'src')!.empty).toBe(false);
    // A file is never an empty directory
    expect(rows.find((r) => r.entry.name === 'readme.md')!.empty).toBe(false);
  });

  it('stops recursing when a child path repeats an ancestor (self-referencing symlink / abnormal backend result), without a stack overflow', () => {
    const selfRef: FsEntry[] = [{ name: 'loop', path: '/root/loop', is_dir: true }];
    const rows = flattenVisible(selfRef, new Set(['/root/loop']), { '/root/loop': selfRef });
    // Child rows still render, but recursion does not go deeper
    expect(rows.map((r) => `${r.depth}:${r.entry.name}`)).toEqual(['0:loop', '1:loop']);
  });
});
