import { expect, it } from 'vitest';
import { clampPaneRatio, paneTreeOperations, type PaneTree } from '../paneTree';

type Leaf = { type: 'pane'; id: string };
type Tree = PaneTree<Leaf>;
const a: Leaf = { type: 'pane', id: 'a' }; const b: Leaf = { type: 'pane', id: 'b' };
const tree = paneTreeOperations<Tree, Leaf>({
  leaf: node => node.type === 'pane' ? node : null,
  children: node => { const split = node as Extract<Tree, { type: 'split' }>; return [split.first, split.second]; },
  join: (node, first, second) => ({ ...node as Extract<Tree, { type: 'split' }>, first, second }), id: node => node.id,
  withRatio: (node, ratio) => ({ ...node, ratio }),
});
const pair: Tree = { type: 'split', direction: 'row', ratio: 0.5, first: a, second: b };

it('shares traversal, stable updates, replacement and collapsing removal across leaf domains', () => {
  expect(tree.leaves(pair)).toEqual([a, b]);
  expect(tree.map(pair, (_leaf, node) => node)).toBe(pair);
  expect(tree.update(pair, 'missing', () => a)).toBe(pair);
  expect(tree.update(pair, 'a', () => ({ ...a, id: 'new' }))).toMatchObject({ first: { id: 'new' }, second: b });
  expect(tree.remove(pair, 'a')).toBe(b);
  expect(tree.remove(pair, 'b')).toBe(a);
  expect(tree.remove(a, 'a')).toBeNull();
  expect(tree.remove(pair, 'missing')).toBe(pair);
  expect(tree.map(pair, () => null)).toBeNull();
  expect(clampPaneRatio(Number.NaN)).toBe(0.5);
  expect(clampPaneRatio(-1)).toBe(0.2);
  expect(clampPaneRatio(2)).toBe(0.8);
  expect(clampPaneRatio(0.4)).toBe(0.4);
  expect(tree.ratio(pair, 'a', 'b', 1)).toMatchObject({ ratio: 0.8 });
  expect(tree.ratio(pair, 'a', 'missing', 0.4)).toBe(pair);
  const nested: Tree = { ...pair, first: { ...pair, second: { type: 'pane', id: 'c' } } };
  expect(tree.ratio(nested, 'a', 'c', 0.3)).toMatchObject({ first: { ratio: 0.3 } });
});
