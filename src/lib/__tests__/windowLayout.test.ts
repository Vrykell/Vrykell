import { describe, it, expect } from 'vitest';
import {
  leaf, splitLeaf, replaceLeaf, removeLeaf, leaves, countLeaves,
  leafRects, dropTargets, moveTargets, dividers, setRatio, findLeaf, leafDepth,
  maxRowPanes, minTerminalWidth, MIN_PANE_SIZE, DIVIDER_SIZE,
  type TerminalSpec,
} from '../windowLayout';

const t = (id: string, kind: 'local' | 'ssh' = 'local'): TerminalSpec => ({ id, kind });

describe('windowLayout 基础', () => {
  it('leaf / countLeaves / leaves', () => {
    const l = leaf(t('a'));
    expect(countLeaves(l)).toBe(1);
    expect(leaves(l).map((x) => x.id)).toEqual(['a']);
  });

  it('splitLeaf 分裂叶子（first/second）', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'first', t('b'), 0.5);
    expect(countLeaves(l)).toBe(2);
    expect(leaves(l).map((x) => x.id)).toEqual(['b', 'a']);
    const l2 = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'), 0.5);
    expect(leaves(l2).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('replaceLeaf 替换终端', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    const r = replaceLeaf(l, 'b', t('c'));
    expect(leaves(r).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('removeLeaf 移除后父节点提升孩子', () => {
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

describe('windowLayout 几何', () => {
  it('leafRects：左右分裂各占一半', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'first', t('b'), 0.5);
    const m = new Map(leafRects(l).map((r) => [r.terminalId, r.rect]));
    expect(m.get('b')).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(m.get('a')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it('leafRects：上下分裂', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'col', 'first', t('b'), 0.5);
    const m = new Map(leafRects(l).map((r) => [r.terminalId, r.rect]));
    expect(m.get('b')).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(m.get('a')).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe('windowLayout 停靠落点（与约定一致）', () => {
  it('1 终端：4 个落点（左右上下半屏）', () => {
    const l = leaf(t('a'));
    const d = dropTargets(l);
    expect(d.length).toBe(4);
  });

  it('2 终端：4 个落点（1/4 屏）', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    const d = dropTargets(l);
    expect(d.length).toBe(4);
    // 每个落点都是 1/4 屏
    for (const x of d) expect(x.rect.w * x.rect.h).toBeCloseTo(0.25);
  });

  it('3 终端：只能分裂未分裂的半屏（2 个落点）', () => {
    // a,b 在左半屏上下分裂；c 在右半屏
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c')); // a | c
    l = splitLeaf(l, 'a', 'col', 'second', t('b')); // a/b | c
    const d = dropTargets(l);
    expect(d.length).toBe(2);
    // 落点都在右半屏（x >= 0.5）
    for (const x of d) expect(x.rect.x).toBeGreaterThanOrEqual(0.5);
  });

  it('4 终端：无落点（只能替换）', () => {
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    l = splitLeaf(l, 'a', 'col', 'second', t('b'));
    l = splitLeaf(l, 'c', 'col', 'second', t('d'));
    expect(countLeaves(l)).toBe(4);
    expect(dropTargets(l).length).toBe(0);
  });
});

describe('windowLayout 移动落点', () => {
  it('moveTargets：单终端无落点（不可移动）', () => {
    expect(moveTargets(leaf(t('a')), 'a')).toEqual([]);
  });

  it('moveTargets：2 终端时对另一终端给上下左右 4 个边沿落点', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b')); // a | b
    const d = moveTargets(l, 'a');
    expect(d.length).toBe(4);
    expect(d.every((x) => x.leafId === 'b')).toBe(true);
    const dirs = d.map((x) => `${x.dir}-${x.position}`).sort();
    expect(dirs).toEqual(['col-first', 'col-second', 'row-first', 'row-second']);
  });

  it('moveTargets：落点矩形相对整个容器（移动 2 终端 = 对半，而非 1/4）', () => {
    const l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b')); // a | b
    const d = moveTargets(l, 'a');
    for (const x of d) {
      expect(x.rect.w * x.rect.h).toBeCloseTo(0.5);
    }
  });

  it('moveTargets：4 终端时其它 3 个终端各 4 个落点', () => {
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    l = splitLeaf(l, 'a', 'col', 'second', t('b'));
    l = splitLeaf(l, 'c', 'col', 'second', t('d'));
    const d = moveTargets(l, 'a');
    expect(d.length).toBe(12);
    expect(new Set(d.map((x) => x.leafId))).toEqual(new Set(['b', 'c', 'd']));
  });
});

describe('windowLayout 动态最小宽度', () => {
  it('maxRowPanes：单终端=1，左右=相加，上下=取大', () => {
    expect(maxRowPanes(leaf(t('a')))).toBe(1);
    const row = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    expect(maxRowPanes(row)).toBe(2);
    const col = splitLeaf(leaf(t('a')), 'a', 'col', 'second', t('b'));
    expect(maxRowPanes(col)).toBe(1);
  });

  it('maxRowPanes：2×2 = 2，左 1 + 右上下 2 = 2', () => {
    let l = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    l = splitLeaf(l, 'a', 'col', 'second', t('b'));
    l = splitLeaf(l, 'c', 'col', 'second', t('d'));
    expect(maxRowPanes(l)).toBe(2);
    // a | (b / c)：左边 1 个，右边上下堆 2 个，最宽一行 2
    let m = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    m = splitLeaf(m, 'c', 'col', 'second', t('b'));
    expect(maxRowPanes(m)).toBe(2);
  });

  it('minTerminalWidth：随并排数量线性增长', () => {
    expect(minTerminalWidth(leaf(t('a')))).toBe(MIN_PANE_SIZE);
    const row2 = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('b'));
    expect(minTerminalWidth(row2)).toBe(MIN_PANE_SIZE * 2 + DIVIDER_SIZE);
    let four = splitLeaf(leaf(t('a')), 'a', 'row', 'second', t('c'));
    four = splitLeaf(four, 'a', 'col', 'second', t('b'));
    four = splitLeaf(four, 'c', 'col', 'second', t('d'));
    expect(minTerminalWidth(four)).toBe(MIN_PANE_SIZE * 2 + DIVIDER_SIZE);
  });
});

describe('windowLayout 分隔线', () => {
  it('dividers 与 setRatio', () => {
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
