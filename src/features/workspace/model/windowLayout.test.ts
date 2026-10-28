import { describe, it, expect } from 'vitest';
import {
  leaf, splitLeaf, replaceLeaf, removeLeaf, leaves, countLeaves,
  leafRects, dropTargets, moveTargets, dividers, setRatio, findLeaf, leafDepth,
  maxRowPanes, minTerminalWidth, MIN_PANE_WIDTH, DIVIDER_SIZE,
  collectLayoutCells,
  parseWindowLayout, mapTerminals,
  type TerminalSpec,
} from '@features/workspace/model/windowLayout';
import { fitWorkspacePanes, terminalWorkspaceLayout } from './workspaceResources';

const t = (id: string, kind: 'local' | 'ssh' = 'local'): TerminalSpec => ({ id, kind });

it('maps terminal metadata through shared traversal without changing unchanged nodes', () => {
  const first = leaf(t('a')); const pair = splitLeaf(first, 'a', 'row', 'second', t('b'));
  expect(mapTerminals(pair, terminal => terminal)).toBe(pair);
  const mapped = mapTerminals(pair, terminal => terminal.id === 'b' ? { ...terminal, cwd: '/updated' } : terminal);
  expect(leaves(mapped)).toEqual([t('a'), { ...t('b'), cwd: '/updated' }]);
  expect(mapped.type === 'split' && mapped.first).toBe(first);
});

it('validates legacy layouts before resource hydration, bounds nesting and rejects duplicate identities', () => {
  const a = leaf(t('a')); const b = leaf(t('b'));
  const pair = { type: 'split', dir: 'row', ratio: 0.5, first: a, second: b };
  expect(parseWindowLayout(pair)).toEqual(pair);
  expect(parseWindowLayout({ ...pair, dir: 'col', ratio: -3 })).toMatchObject({ ratio: 0.2 });
  expect(parseWindowLayout(leaf({ id: 'ssh', kind: 'ssh', ssh: { name: 'Host', host: 'host', autoReconnect: true } }))).toMatchObject({ terminal: { ssh: { autoReconnect: true } } });
  for (const value of [null, 1, {}, leaf({ id: '', kind: 'local' }), leaf(t('ssh', 'ssh')), { ...pair, second: a },
    { ...pair, dir: 'invalid' }, { ...pair, ratio: Infinity }, { ...pair, ratio: 'half' }, { ...pair, second: null },
    { ...pair, first: { ...pair, first: { ...pair, first: { ...pair, first: a } } } },
    { ...pair, first: pair, second: { ...pair, first: leaf(t('c')), second: { ...pair, first: leaf(t('d')), second: leaf(t('e')) } } },
  ]) expect(parseWindowLayout(value)).toBeNull();
});

it('caps terminal containers and updates only the selected nested divider', () => {
  let layout = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
  expect(splitLeaf(layout, 'a', 'row', 'second', t('b'))).toBe(layout);
  layout = splitLeaf(layout, 'b', 'col', 'second', t('c'));
  layout = splitLeaf(layout, 'c', 'row', 'second', t('d'));
  expect(splitLeaf(layout, 'a', 'row', 'second', t('e'))).toBe(layout);
  expect(setRatio(leaf(t('a')), 'a', 'b', 1)).toEqual(leaf(t('a')));
  const resized = setRatio(layout, 'c', 'd', 0.3);
  expect(dividers(resized).find(divider => divider.aId === 'c' && divider.bId === 'd')?.ratio).toBe(0.3);
});

describe('windowLayout basics', () => {
  it('leaf / countLeaves / leaves', () => {
    const l = leaf(t('a'));
    expect(countLeaves(l)).toBe(1);
    expect(leaves(l).map((x) => x.id)).toEqual(['a']);
  });

  it('splitLeaf splits a leaf into first and second children', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'first', t('b'), 0.5);
    expect(countLeaves(l)).toBe(2);
    expect(leaves(l).map((x) => x.id)).toEqual(['b', 'a']);
    const l2 = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'), 0.5);
    expect(leaves(l2).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('replaceLeaf replaces a terminal', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    const r = replaceLeaf(l, 'b', t('c'));
    expect(leaves(r).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('removeLeaf promotes the sibling after removal', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    const r = removeLeaf(l, 'b');
    expect(r).toEqual({ type: 'leaf', terminal: t('a') });
  });

  it('findLeaf / leafDepth', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    expect(findLeaf(l, 'b')!.id).toBe('b');
    expect(leafDepth(l, 'a')).toBe(1);
    expect(leafDepth(l, 'b')).toBe(1);
  });
});

describe('windowLayout geometry', () => {
  it('leafRects: a horizontal split gives each side half', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'first', t('b'), 0.5);
    const m = new Map(leafRects(l).map((r) => [r.terminalId, r.rect]));
    expect(m.get('b')).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(m.get('a')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it('leafRects: a vertical split', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'col', 'first', t('b'), 0.5);
    const m = new Map(leafRects(l).map((r) => [r.terminalId, r.rect]));
    expect(m.get('b')).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(m.get('a')).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it('collectLayoutCells: each terminal id appears once with correct geometry and inner borders', () => {
    // (a | b) / c: the top row splits a|b and the bottom half contains c (column split).
    const bc = splitLeaf(leaf(t('b')), 'b', 'col', 'second', t('c'), 0.5);
    const l = splitLeaf(bc, 'b', 'row', 'first', t('a'), 0.5);
    const cells = collectLayoutCells(l);
    const byId = new Map(cells.map((c) => [c.terminalId, c]));
    expect(cells.map((c) => c.terminalId)).toEqual(['a', 'b', 'c']);

    // a is in the top-left quadrant; its right edge faces b and its bottom edge faces c.
    expect(byId.get('a')!.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(byId.get('a')!.inner).toEqual({ left: false, right: true, top: false, bottom: true });

    // b is in the top-right quadrant; its left edge faces a and its bottom edge faces c.
    expect(byId.get('b')!.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(byId.get('b')!.inner).toEqual({ left: true, right: false, top: false, bottom: true });

    // c spans the bottom half; its top edge faces a and b.
    expect(byId.get('c')!.rect).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
    expect(byId.get('c')!.inner).toEqual({ left: false, right: false, top: true, bottom: false });
  });

  it('collectLayoutCells: drag reordering keeps the same terminal ids so render identity stays stable', () => {
    const bc = splitLeaf(leaf(t('b')), 'b', 'col', 'second', t('c'), 0.5);
    const before = splitLeaf(bc, 'b', 'row', 'first', t('a'), 0.5);
    // Simulate dragging a below b: remove a, then insert it into b's left half.
    const removed = removeLeaf(before, 'a')!;
    const after = splitLeaf(removed, 'b', 'col', 'second', t('a'), 0.5);

    const idsBefore = collectLayoutCells(before).map((c) => c.terminalId).sort();
    const idsAfter = collectLayoutCells(after).map((c) => c.terminalId).sort();
    expect(idsAfter).toEqual(idsBefore); // Same terminals, only position and structure changed.
    expect(idsAfter).toEqual(['a', 'b', 'c']);
  });

  it('dividers: nested dividers carry their own region so drag ratios use the child region', () => {
    // (c | b) / a: c|b split horizontally in the top half and a in the bottom (root column split).
    const cb = splitLeaf(leaf(t('c')), 'c', 'row', 'second', t('b'), 0.5);
    const l = splitLeaf(cb, 'c', 'col', 'second', t('a'), 0.5);
    const ds = dividers(l);
    expect(ds).toHaveLength(2);

    // Exactly one root divider covers the whole window; the nested divider has a proper subset region.
    const root = ds.find((d) =>
      d.region.x === 0 && d.region.y === 0 && d.region.w === 1 && d.region.h === 1,
    );
    expect(root).toBeDefined();
    const inner = ds.find((d) => d !== root);
    expect(inner).toBeDefined();
    expect(inner!.region.w).toBeLessThan(1);

    // Each divider rect stays inside its own region.
    for (const d of ds) {
      expect(d.rect.x).toBeGreaterThanOrEqual(d.region.x - 1e-9);
      expect(d.rect.y).toBeGreaterThanOrEqual(d.region.y - 1e-9);
      expect(d.rect.x + d.rect.w).toBeLessThanOrEqual(d.region.x + d.region.w + 1e-9);
      expect(d.rect.y + d.rect.h).toBeLessThanOrEqual(d.region.y + d.region.h + 1e-9);
    }
  });
});

describe('windowLayout drop targets (matching the contract)', () => {
  it('1 terminal: 4 drop targets (left, right, top and bottom halves)', () => {
    const l = leaf(t('a'));
    const d = dropTargets(l);
    expect(d.length).toBe(4);
  });

  it('2 terminals: 4 quarter-screen drop targets', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    const d = dropTargets(l);
    expect(d.length).toBe(4);
    // Every target covers a quarter of the screen.
    for (const x of d) expect(x.rect.w * x.rect.h).toBeCloseTo(0.25);
  });

  it('3 terminals: only an unsplit half can be split, giving 2 targets', () => {
    // a and b split the left half vertically; c stays in the right half.
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c')); // a | c
    l = splitLeaf(l, 'a', 'col', 'second', t('b')); // a/b | c
    const d = dropTargets(l);
    expect(d.length).toBe(2);
    // Both targets are in the right half (x >= 0.5).
    for (const x of d) expect(x.rect.x).toBeGreaterThanOrEqual(0.5);
  });

  it('4 terminals: no drop targets remain and panes can only be replaced', () => {
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    l = splitLeaf(l, 'a', 'col', 'second', t('b'));
    l = splitLeaf(l, 'c', 'col', 'second', t('d'));
    expect(countLeaves(l)).toBe(4);
    expect(dropTargets(l).length).toBe(0);
  });
});

describe('windowLayout move targets', () => {
  it('moveTargets: a single terminal has no move targets', () => {
    expect(moveTargets(leaf(t('a')), 'a')).toEqual([]);
  });

  it('moveTargets: with 2 terminals the other terminal gets 4 edge targets', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b')); // a | b
    const d = moveTargets(l, 'a');
    expect(d.length).toBe(4);
    expect(d.every((x) => x.leafId === 'b')).toBe(true);
    const dirs = d.map((x) => `${x.dir}-${x.position}`).sort();
    expect(dirs).toEqual(['col-first', 'col-second', 'row-first', 'row-second']);
  });

  it('moveTargets: target rects are relative to the whole container, so moving between 2 terminals is a half, not a quarter', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b')); // a | b
    const d = moveTargets(l, 'a');
    for (const x of d) {
      expect(x.rect.w * x.rect.h).toBeCloseTo(0.5);
    }
  });

  it('moveTargets: with 4 terminals each of the other 3 terminals gets 4 targets', () => {
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    l = splitLeaf(l, 'a', 'col', 'second', t('b'));
    l = splitLeaf(l, 'c', 'col', 'second', t('d'));
    const d = moveTargets(l, 'a');
    expect(d.length).toBe(12);
    expect(new Set(d.map((x) => x.leafId))).toEqual(new Set(['b', 'c', 'd']));
  });
});

describe('windowLayout dynamic minimum width', () => {
  it('maxRowPanes: one terminal is 1, side-by-side adds, stacked takes the maximum', () => {
    expect(maxRowPanes(leaf(t('a')))).toBe(1);
    const row = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    expect(maxRowPanes(row)).toBe(2);
    const col = splitLeaf(leaf(t('a')), 'a', 'col', 'second', t('b'));
    expect(maxRowPanes(col)).toBe(1);
  });

  it('maxRowPanes: a 2x2 grid is 2 and left 1 plus right stacked 2 is 2', () => {
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    l = splitLeaf(l, 'a', 'col', 'second', t('b'));
    l = splitLeaf(l, 'c', 'col', 'second', t('d'));
    expect(maxRowPanes(l)).toBe(2);
    // a | (b / c): one on the left and two stacked on the right, so the widest row is 2.
    let m = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    m = splitLeaf(m, 'c', 'col', 'second', t('b'));
    expect(maxRowPanes(m)).toBe(2);
  });

  it('reserves usable toolbar width for every horizontal pane', () => {
    expect(minTerminalWidth(leaf(t('a')))).toBe(MIN_PANE_WIDTH);
    const row2 = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    expect(minTerminalWidth(row2)).toBe(MIN_PANE_WIDTH * 2 + DIVIDER_SIZE);
    let four = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    four = splitLeaf(four, 'a', 'col', 'second', t('b'));
    four = splitLeaf(four, 'c', 'col', 'second', t('d'));
    expect(minTerminalWidth(four)).toBe(MIN_PANE_WIDTH * 2 + DIVIDER_SIZE);
  });

  it('clamps narrow displayed panes after resize without changing saved ratios', () => {
    const saved = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'), 0.1);
    const fitted = fitWorkspacePanes(terminalWorkspaceLayout(saved), 1000, 600).layout;
    expect(fitted.type === 'split' && fitted.ratio * 1000).toBeGreaterThanOrEqual(MIN_PANE_WIDTH);
    expect(saved.type === 'split' && saved.ratio).toBe(0.1);
    const restored = fitWorkspacePanes(terminalWorkspaceLayout(saved), 4000, 600).layout;
    expect(restored.type === 'split' && restored.ratio).toBe(0.2);
  });
});

describe('windowLayout dividers', () => {
  it('dividers and setRatio', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'), 0.5);
    const ds = dividers(l);
    expect(ds.length).toBe(1);
    expect(ds[0]).toMatchObject({ dir: 'row', aId: 'a', bId: 'b', ratio: 0.5 });

    const r = setRatio(l, 'a', 'b', 0.3);
    const m = new Map(leafRects(r).map((x) => [x.terminalId, x.rect]));
    expect(m.get('a')!.w).toBeCloseTo(0.3);
    expect(m.get('b')!.w).toBeCloseTo(0.7);
  });
});
