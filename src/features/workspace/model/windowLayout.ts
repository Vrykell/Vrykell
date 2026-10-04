/**
 * windowLayout — 窗口（会话）内终端的二叉分裂树布局。
 *
 * 一个窗口是一个容器，持有 1–4 个终端。布局是一棵二叉树：
 *   - leaf：一个终端
 *   - split：把一块区域按 dir 平分成 first / second，ratio 为 first 占比
 *
 * 停靠规则（与用户约定一致）：
 *   - 1 终端：可分裂成左右/上下四个 1/2 屏（4 个落点）
 *   - 2 终端：可分裂某个半屏成 1/4 屏（4 个落点）
 *   - 3 终端：只能分裂还没被分裂的那个半屏（2 个落点）
 *   - 4 终端：满，只能替换
 *   （「可分裂」= 叶子深度 ≤ 1：根叶子或根的直接孩子）
 */

export type SplitDir = 'row' | 'col'; // row = 左右，col = 上下
import type { SshOptions } from '@core/ssh';

export interface TerminalSpec {
  id: string;
  kind: 'local' | 'ssh';
  shellType?: string;
  ssh?: SshOptions & { name: string; host: string; user?: string; port?: number; connectionId?: string };
  cwd?: string;
  /** 打开模式：classic = 经典 xterm；block = 块列表视图（SSH 恒 classic） */
  openMode?: 'classic' | 'block';
}

export type WindowLayout =
  | { type: 'leaf'; terminal: TerminalSpec }
  | { type: 'split'; dir: SplitDir; ratio: number; first: WindowLayout; second: WindowLayout };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DropTarget {
  /** 被分裂的叶子终端 id */
  leafId: string;
  dir: SplitDir;
  position: 'first' | 'second';
  /** 新终端落点矩形（0..1 相对窗口） */
  rect: Rect;
}

export interface Divider {
  dir: SplitDir;
  ratio: number;
  /** first 子树的第一个终端 id / second 子树的第一个终端 id（稳定标识） */
  aId: string;
  bId: string;
  /** 分隔线位置（相对窗口） */
  rect: Rect;
  /** 该 split 节点自身占据的区域（相对窗口）—— 嵌套分隔线拖拽比例以它为准 */
  region: Rect;
}

/** 每个终端（pane）的最小尺寸（px）——动态最小宽度的基准，尽量小以最大化拖动范围。 */
export const MIN_PANE_SIZE = 135;
/** 分隔线厚度（px）。 */
export const DIVIDER_SIZE = 6;

export function leaf(terminal: TerminalSpec): WindowLayout {
  return { type: 'leaf', terminal };
}

export function countLeaves(layout: WindowLayout): number {
  if (layout.type === 'leaf') return 1;
  return countLeaves(layout.first) + countLeaves(layout.second);
}

/** 同一水平行里最多有多少个终端（row 相加、col 取较大），用于按布局动态计算窗口最小宽度。 */
export function maxRowPanes(layout: WindowLayout): number {
  if (layout.type === 'leaf') return 1;
  return layout.dir === 'row'
    ? maxRowPanes(layout.first) + maxRowPanes(layout.second)
    : Math.max(maxRowPanes(layout.first), maxRowPanes(layout.second));
}

/** 窗口（会话容器）的最小宽度：最宽一行 × 每终端最小宽 + 分隔线厚度。 */
export function minTerminalWidth(layout: WindowLayout): number {
  const n = maxRowPanes(layout);
  return n * MIN_PANE_SIZE + (n - 1) * DIVIDER_SIZE;
}

export function leaves(layout: WindowLayout): TerminalSpec[] {
  if (layout.type === 'leaf') return [layout.terminal];
  return [...leaves(layout.first), ...leaves(layout.second)];
}

export function firstLeaf(layout: WindowLayout): TerminalSpec {
  if (layout.type === 'leaf') return layout.terminal;
  return firstLeaf(layout.first);
}

export function findLeaf(layout: WindowLayout, id: string): TerminalSpec | null {
  if (layout.type === 'leaf') return layout.terminal.id === id ? layout.terminal : null;
  return findLeaf(layout.first, id) ?? findLeaf(layout.second, id);
}

/** 叶子深度：根叶子=0，根直接孩子=1，更深则 >1；未找到 -1。 */
export function leafDepth(layout: WindowLayout, id: string, depth = 0): number {
  if (layout.type === 'leaf') return layout.terminal.id === id ? depth : -1;
  const d = leafDepth(layout.first, id, depth + 1);
  return d >= 0 ? d : leafDepth(layout.second, id, depth + 1);
}

const perpendicular = (dir: SplitDir): SplitDir => (dir === 'row' ? 'col' : 'row');

/** 分裂某个叶子，把新终端放到该叶子区域的第一/第二半。 */
export function splitLeaf(
  root: WindowLayout,
  leafId: string,
  dir: SplitDir,
  position: 'first' | 'second',
  newTerminal: TerminalSpec,
  ratio = 0.5,
): WindowLayout {
  if (root.type === 'leaf') {
    if (root.terminal.id !== leafId) return root;
    const nl = leaf(newTerminal);
    return position === 'first'
      ? { type: 'split', dir, ratio, first: nl, second: root }
      : { type: 'split', dir, ratio, first: root, second: nl };
  }
  return {
    ...root,
    first: splitLeaf(root.first, leafId, dir, position, newTerminal, ratio),
    second: splitLeaf(root.second, leafId, dir, position, newTerminal, ratio),
  };
}

/** 替换某个叶子里的终端。 */
export function replaceLeaf(root: WindowLayout, leafId: string, newTerminal: TerminalSpec): WindowLayout {
  if (root.type === 'leaf') {
    return root.terminal.id === leafId ? leaf(newTerminal) : root;
  }
  return {
    ...root,
    first: replaceLeaf(root.first, leafId, newTerminal),
    second: replaceLeaf(root.second, leafId, newTerminal),
  };
}

/** 移除某个叶子；父节点若只剩一个孩子则提升该孩子。 */
export function removeLeaf(root: WindowLayout, leafId: string): WindowLayout | null {
  if (root.type === 'leaf') return root.terminal.id === leafId ? null : root;
  const first = removeLeaf(root.first, leafId);
  const second = removeLeaf(root.second, leafId);
  if (first === null) return second; // 只剩 second
  if (second === null) return first; // 只剩 first
  return { ...root, first, second };
}

/** 每个叶子的几何矩形（0..1 相对窗口）。 */
export function leafRects(
  layout: WindowLayout,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
): { terminalId: string; rect: Rect }[] {
  if (layout.type === 'leaf') return [{ terminalId: layout.terminal.id, rect }];
  const r = Math.max(0, Math.min(1, layout.ratio));
  if (layout.dir === 'row') {
    return [
      ...leafRects(layout.first, { x: rect.x, y: rect.y, w: rect.w * r, h: rect.h }),
      ...leafRects(layout.second, { x: rect.x + rect.w * r, y: rect.y, w: rect.w * (1 - r), h: rect.h }),
    ];
  }
  return [
    ...leafRects(layout.first, { x: rect.x, y: rect.y, w: rect.w, h: rect.h * r }),
    ...leafRects(layout.second, { x: rect.x, y: rect.y + rect.h * r, w: rect.w, h: rect.h * (1 - r) }),
  ];
}

/** 可停靠落点（按上面的停靠规则）。 */
export function dropTargets(layout: WindowLayout): DropTarget[] {
  const targets: DropTarget[] = [];
  const rectMap = new Map(leafRects(layout).map((r) => [r.terminalId, r.rect]));

  const walk = (node: WindowLayout, depth: number, parentDir: SplitDir | null) => {
    if (node.type === 'leaf') {
      if (depth > 1) return;
      const rect = rectMap.get(node.terminal.id)!;
      const dirs: SplitDir[] = depth === 0 ? ['row', 'col'] : [perpendicular(parentDir!)];
      for (const dir of dirs) {
        const first = dir === 'row'
          ? { x: rect.x, y: rect.y, w: rect.w / 2, h: rect.h }
          : { x: rect.x, y: rect.y, w: rect.w, h: rect.h / 2 };
        const second = dir === 'row'
          ? { x: rect.x + rect.w / 2, y: rect.y, w: rect.w / 2, h: rect.h }
          : { x: rect.x, y: rect.y + rect.h / 2, w: rect.w, h: rect.h / 2 };
        targets.push({ leafId: node.terminal.id, dir, position: 'first', rect: first });
        targets.push({ leafId: node.terminal.id, dir, position: 'second', rect: second });
      }
      return;
    }
    walk(node.first, depth + 1, node.dir);
    walk(node.second, depth + 1, node.dir);
  };
  walk(layout, 0, null);
  return targets;
}

/**
 * 移动终端的落点：对每个「其它终端」给出上下左右四个边沿落点（吸附式）。
 * 与分裂（dropTargets）不同：移动时被拖动终端会先移除，落点只面向剩余终端，
 * 因此不受「深度 ≤ 1」限制，可自由放到任意其它终端的上/下/左/右。
 */
export function moveTargets(layout: WindowLayout, dragId: string): DropTarget[] {
  // 先移除被拖动终端，落点矩形以「移除后的整个容器」为基准，忠实反映最终落位（而非目标终端当前子区域）
  const remaining = removeLeaf(layout, dragId);
  if (!remaining) return [];
  const targets: DropTarget[] = [];
  for (const { terminalId, rect } of leafRects(remaining)) {
    for (const dir of ['row', 'col'] as SplitDir[]) {
      for (const position of ['first', 'second'] as const) {
        const first = dir === 'row'
          ? { x: rect.x, y: rect.y, w: rect.w / 2, h: rect.h }
          : { x: rect.x, y: rect.y, w: rect.w, h: rect.h / 2 };
        const second = dir === 'row'
          ? { x: rect.x + rect.w / 2, y: rect.y, w: rect.w / 2, h: rect.h }
          : { x: rect.x, y: rect.y + rect.h / 2, w: rect.w, h: rect.h / 2 };
        targets.push({ leafId: terminalId, dir, position, rect: position === 'first' ? first : second });
      }
    }
  }
  return targets;
}

/** 全部分隔线（用于渲染与拖拽调比例）。 */
export function dividers(layout: WindowLayout): Divider[] {
  const list: Divider[] = [];
  const walk = (node: WindowLayout, rect: Rect) => {
    if (node.type === 'leaf') return;
    const r = Math.max(0, Math.min(1, node.ratio));
    const aId = firstLeaf(node.first).id;
    const bId = firstLeaf(node.second).id;
    const line: Rect = node.dir === 'row'
      ? { x: rect.x + rect.w * r, y: rect.y, w: 0, h: rect.h }
      : { x: rect.x, y: rect.y + rect.h * r, w: rect.w, h: 0 };
    list.push({ dir: node.dir, ratio: node.ratio, aId, bId, rect: line, region: rect });
    const r2 = node.dir === 'row'
      ? [
          { x: rect.x, y: rect.y, w: rect.w * r, h: rect.h },
          { x: rect.x + rect.w * r, y: rect.y, w: rect.w * (1 - r), h: rect.h },
        ]
      : [
          { x: rect.x, y: rect.y, w: rect.w, h: rect.h * r },
          { x: rect.x, y: rect.y + rect.h * r, w: rect.w, h: rect.h * (1 - r) },
        ];
    walk(node.first, r2[0]!);
    walk(node.second, r2[1]!);
  };
  walk(layout, { x: 0, y: 0, w: 1, h: 1 });
  return list;
}

/** 调整分隔线比例（用 aId/bId 定位 split 节点）。 */
export function setRatio(root: WindowLayout, aId: string, bId: string, ratio: number): WindowLayout {
  if (root.type === 'leaf') return root;
  if (firstLeaf(root.first).id === aId && firstLeaf(root.second).id === bId) {
    return { ...root, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
  }
  return {
    ...root,
    first: setRatio(root.first, aId, bId, ratio),
    second: setRatio(root.second, aId, bId, ratio),
  };
}

/** 终端的几何矩形 + 面向相邻终端的内侧边框标记（左/右/上/下）。 */
export interface LayoutCell {
  terminalId: string;
  rect: Rect;
  inner: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/**
 * 布局树遍历收集：返回每个终端的几何矩形（0..1 相对窗口）与内侧边框标记。
 * 供平面渲染（PaneLayout）一次性绝对定位所有 pane —— 拖动重排只改几何，
 * 不重挂终端组件（重挂会 ptyClose 杀掉运行中命令）。
 */
export function collectLayoutCells(layout: WindowLayout): LayoutCell[] {
  const out: LayoutCell[] = [];
  const walk = (node: WindowLayout, rect: Rect, inner: LayoutCell['inner']) => {
    if (node.type === 'leaf') {
      out.push({ terminalId: node.terminal.id, rect, inner });
      return;
    }
    const r = Math.max(0.1, Math.min(0.9, node.ratio));
    const firstInner = node.dir === 'row' ? { ...inner, right: true } : { ...inner, bottom: true };
    const secondInner = node.dir === 'row' ? { ...inner, left: true } : { ...inner, top: true };
    const firstRect: Rect = node.dir === 'row'
      ? { x: rect.x, y: rect.y, w: rect.w * r, h: rect.h }
      : { x: rect.x, y: rect.y, w: rect.w, h: rect.h * r };
    const secondRect: Rect = node.dir === 'row'
      ? { x: rect.x + rect.w * r, y: rect.y, w: rect.w * (1 - r), h: rect.h }
      : { x: rect.x, y: rect.y + rect.h * r, w: rect.w, h: rect.h * (1 - r) };
    walk(node.first, firstRect, firstInner);
    walk(node.second, secondRect, secondInner);
  };
  walk(layout, { x: 0, y: 0, w: 1, h: 1 }, { left: false, right: false, top: false, bottom: false });
  return out;
}
