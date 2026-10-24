import { expect, it } from 'vitest';
import { measurePaneTree } from '../paneLayout';

type Tree = string | { dir: 'row' | 'col'; ratio: number; first: Tree; second: Tree };
const describe = (node: Tree) => typeof node === 'string' ? { id: node } : node;
it('shares stable flat geometry, interior edges and the existing split-placement rules', () => {
  const layout: Tree = { dir: 'row', ratio: 0.6, first: 'one', second: { dir: 'col', ratio: 0.5, first: 'two', second: 'three' } };
  const measured = measurePaneTree(layout, describe);
  expect(measured.cells.map(cell => cell.id)).toEqual(['one', 'two', 'three']);
  expect(measured.cells[0]).toMatchObject({ rect: { x: 0, y: 0, w: 0.6, h: 1 }, inner: { right: true, left: false, top: false, bottom: false } });
  expect(measured.dividers[1]).toMatchObject({ dir: 'col', aId: 'two', bId: 'three', region: { x: 0.6, y: 0, w: 0.4, h: 1 } });
  expect(measured.targets.map(target => [target.leafId, target.dir, target.position])).toEqual([['one', 'col', 'first'], ['one', 'col', 'second']]);
});
