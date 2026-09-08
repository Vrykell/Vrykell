import { describe, expect, it } from 'vitest';
import {
  collectLayoutCells,
  countLeaves,
  DIVIDER_SIZE,
  dividers,
  dropTargets,
  findLeaf,
  leaf,
  leafDepth,
  leafRects,
  leaves,
  MIN_PANE_SIZE,
  maxRowPanes,
  minTerminalWidth,
  moveTargets,
  removeLeaf,
  replaceLeaf,
  setRatio,
  splitLeaf,
  type TerminalSpec,
} from '@/services/tauri/windowLayout';

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

  it('collectLayoutCells：终端 id 恰好出现一次，几何与 inner 边框正确', () => {
    // (a | b) / c：上半行分裂 a|b，下半 c（列分裂）
    const bc = splitLeaf(leaf(t('b')), 'b', 'col', 'second', t('c'), 0.5);
    const l = splitLeaf(bc, 'b', 'row', 'first', t('a'), 0.5);
    const cells = collectLayoutCells(l);
    const byId = new Map(cells.map((c) => [c.terminalId, c]));
    expect(cells.map((c) => c.terminalId)).toEqual(['a', 'b', 'c']);

    // a 在左上象限，右缘面向 b、底缘面向 c
    expect(byId.get('a')!.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(byId.get('a')!.inner).toEqual({ left: false, right: true, top: false, bottom: true });

    // b 在右上象限，左缘面向 a、底缘面向 c
    expect(byId.get('b')!.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(byId.get('b')!.inner).toEqual({ left: true, right: false, top: false, bottom: true });

    // c 占下半全宽，上缘面向 a/b
    expect(byId.get('c')!.rect).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
    expect(byId.get('c')!.inner).toEqual({ left: false, right: false, top: true, bottom: false });
  });

  it('collectLayoutCells：拖动重排后终端 id 集合不变（渲染身份稳定，不重挂）', () => {
    const bc = splitLeaf(leaf(t('b')), 'b', 'col', 'second', t('c'), 0.5);
    const before = splitLeaf(bc, 'b', 'row', 'first', t('a'), 0.5);
    // 模拟拖动 a 到 b 之下：removeLeaf(a) 后把 a 插到 b 的左半屏
    const removed = removeLeaf(before, 'a')!;
    const after = splitLeaf(removed, 'b', 'col', 'second', t('a'), 0.5);

    const idsBefore = collectLayoutCells(before)
      .map((c) => c.terminalId)
      .sort();
    const idsAfter = collectLayoutCells(after)
      .map((c) => c.terminalId)
      .sort();
    expect(idsAfter).toEqual(idsBefore); // 同一组终端，只是位置/结构变了
    expect(idsAfter).toEqual(['a', 'b', 'c']);
  });

  it('dividers：嵌套分隔线携带自身 region（拖拽比例以子区域为准）', () => {
    // (c | b) / a：c|b 行分裂在上半，a 在下半（根列分裂）
    const cb = splitLeaf(leaf(t('c')), 'c', 'row', 'second', t('b'), 0.5);
    const l = splitLeaf(cb, 'c', 'col', 'second', t('a'), 0.5);
    const ds = dividers(l);
    expect(ds).toHaveLength(2);

    // 恰有一条根分隔线：region 覆盖全窗口；另一条是嵌套分隔线，region 为真子集
    const root = ds.find(
      (d) => d.region.x === 0 && d.region.y === 0 && d.region.w === 1 && d.region.h === 1,
    );
    expect(root).toBeDefined();
    const inner = ds.find((d) => d !== root);
    expect(inner).toBeDefined();
    expect(inner!.region.w).toBeLessThan(1);

    // 分隔线 rect 落于自身 region 内
    for (const d of ds) {
      expect(d.rect.x).toBeGreaterThanOrEqual(d.region.x - 1e-9);
      expect(d.rect.y).toBeGreaterThanOrEqual(d.region.y - 1e-9);
      expect(d.rect.x + d.rect.w).toBeLessThanOrEqual(d.region.x + d.region.w + 1e-9);
      expect(d.rect.y + d.rect.h).toBeLessThanOrEqual(d.region.y + d.region.h + 1e-9);
    }
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
