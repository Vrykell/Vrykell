import { expect, it } from 'vitest';
import { changeTree } from '../model/tree';
it('groups changed paths into sorted folders without losing file metadata', () => {
  const entries = ['z.ts', 'src/b.ts', 'src/nested/a.ts', 'src/a.ts'].map(path => ({ path, previousPath: null, indexStatus: 'M', worktreeStatus: ' ' }));
  const tree = changeTree(entries);
  expect(tree.map(node => node.name)).toEqual(['src', 'z.ts']);
  expect(tree[0]!.children.map(node => node.name)).toEqual(['nested', 'a.ts', 'b.ts']);
  expect(tree[0]!.children[0]!.children[0]!.entry).toBe(entries[2]);
  expect(tree[0]!.children[0]!.path).toBe('src/nested');
});
