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
import { measurePaneTree } from '@core/paneLayout';
import { paneTreeOperations, type PaneTree } from '@core/paneTree';
import { clampPaneRatio } from '@core/paneTree';
import { z } from 'zod';

export interface TerminalSpec {
  id: string;
  kind: 'local' | 'ssh';
  shellType?: string;
  ssh?: SshOptions & { name: string; host: string; user?: string; port?: number; connectionId?: string };
  cwd?: string;
  useProfileDirectory?: boolean;
  /** 打开模式：classic = 经典 xterm；block = 块列表视图（SSH 恒 classic） */
  openMode?: 'classic' | 'block';
}

export type WindowLayout = PaneTree<{ type: 'leaf'; terminal: TerminalSpec }, 'dir'>;

const terminalSpecSchema = z.object({
  id: z.string().min(1).max(256), kind: z.enum(['local', 'ssh']), shellType: z.string().max(64).optional(),
  cwd: z.string().max(8192).optional(), useProfileDirectory: z.boolean().optional(), openMode: z.enum(['classic', 'block']).optional(),
  ssh: z.object({ name: z.string().max(320), host: z.string().min(1).max(2048), user: z.string().max(256).optional(), port: z.number().int().min(1).max(65535).optional(), connectionId: z.string().max(256).optional() }).passthrough().optional(),
});

/** Validate the older native wire encoding before converting it into live pane references. */
export function parseWindowLayout(value: unknown): WindowLayout | null {
  const ids = new Set<string>();
  const parse = (input: unknown, depth: number): WindowLayout | null => {
    if (!input || typeof input !== 'object' || depth > 3) return null;
    const node = input as Record<string, unknown>;
    if (node.type === 'leaf') {
      const result = terminalSpecSchema.safeParse(node.terminal);
      if (!result.success || ids.has(result.data.id) || result.data.kind === 'ssh' && !result.data.ssh) return null;
      ids.add(result.data.id); return { type: 'leaf', terminal: result.data };
    }
    if (node.type !== 'split' || node.dir !== 'row' && node.dir !== 'col' || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio)) return null;
    const first = parse(node.first, depth + 1); const second = parse(node.second, depth + 1);
    return first && second ? { type: 'split', dir: node.dir, ratio: clampPaneRatio(node.ratio), first, second } : null;
  };
  const layout = parse(value, 0); return ids.size <= 4 ? layout : null;
}

const tree = paneTreeOperations<WindowLayout, TerminalSpec>({
  leaf: node => node.type === 'leaf' ? node.terminal : null,
  children: node => { const split = node as Extract<WindowLayout, { type: 'split' }>; return [split.first, split.second]; },
  join: (node, first, second) => ({ ...node, first, second }),
  withRatio: (node, ratio) => ({ ...node, ratio }),
  id: terminal => terminal.id,
});

export const measureWindowLayout = (layout: WindowLayout, rect?: Rect) => measurePaneTree(layout, node => node.type === 'leaf' ? { id: node.terminal.id } : node, rect);

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

/** Minimum vertical space for each terminal pane. */
export const MIN_PANE_SIZE = 135;
/** Keep the command toolbar and composer usable when a pane is narrowed. */
export const MIN_PANE_WIDTH = 360;
/** 分隔线厚度（px）。 */
export const DIVIDER_SIZE = 6;

export function leaf(terminal: TerminalSpec): WindowLayout {
  return { type: 'leaf', terminal };
}

export function countLeaves(layout: WindowLayout): number {
  return tree.leaves(layout).length;
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
  return n * MIN_PANE_WIDTH + (n - 1) * DIVIDER_SIZE;
}

export function leaves(layout: WindowLayout): TerminalSpec[] {
  return tree.leaves(layout);
}

export function mapTerminals(layout: WindowLayout, transform: (terminal: TerminalSpec) => TerminalSpec): WindowLayout {
  return tree.map(layout, (terminal, node) => {
    const next = transform(terminal);
    return next === terminal ? node : leaf(next);
  })!;
}

export function firstLeaf(layout: WindowLayout): TerminalSpec {
  return tree.leaves(layout)[0]!;
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

/** 分裂某个叶子，把新终端放到该叶子区域的第一/第二半。 */
export function splitLeaf(
  root: WindowLayout,
  leafId: string,
  dir: SplitDir,
  position: 'first' | 'second',
  newTerminal: TerminalSpec,
  ratio = 0.5,
): WindowLayout {
  const terminals = tree.leaves(root);
  if (terminals.length >= 4 || terminals.some(terminal => terminal.id === newTerminal.id)) return root;
  return tree.update(root, leafId, node => {
    const next = leaf(newTerminal);
    return position === 'first'
      ? { type: 'split', dir, ratio, first: next, second: node }
      : { type: 'split', dir, ratio, first: node, second: next };
  });
}

/** 替换某个叶子里的终端。 */
export function replaceLeaf(root: WindowLayout, leafId: string, newTerminal: TerminalSpec): WindowLayout {
  return tree.update(root, leafId, () => leaf(newTerminal));
}

/** 移除某个叶子；父节点若只剩一个孩子则提升该孩子。 */
export function removeLeaf(root: WindowLayout, leafId: string): WindowLayout | null {
  return tree.remove(root, leafId);
}

/** 每个叶子的几何矩形（0..1 相对窗口）。 */
export function leafRects(
  layout: WindowLayout,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
): { terminalId: string; rect: Rect }[] {
  return measureWindowLayout(layout, rect).cells.map(({ id, rect: cell }) => ({ terminalId: id, rect: cell }));
}

/** 可停靠落点（按上面的停靠规则）。 */
export function dropTargets(layout: WindowLayout): DropTarget[] {
  return measureWindowLayout(layout).targets;
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
  return measureWindowLayout(layout).dividers;
}

/** 调整分隔线比例（用 aId/bId 定位 split 节点）。 */
export function setRatio(root: WindowLayout, aId: string, bId: string, ratio: number): WindowLayout {
  return tree.ratio(root, aId, bId, ratio);
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
  return measureWindowLayout(layout).cells.map(({ id, ...cell }) => ({ terminalId: id, ...cell }));
}
