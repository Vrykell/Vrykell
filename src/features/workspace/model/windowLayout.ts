/**
 * Binary split tree layout for the terminals inside a window (session).
 *
 * A window is a container holding 1-4 terminals. The layout is a binary tree:
 *   - leaf: a single terminal
 *   - split: divides a region in half along dir into first / second, where ratio is
 *     the share taken by first
 *
 * Docking rules:
 *   - 1 terminal: may split into four half-screen slots (left/right/top/bottom)
 *   - 2 terminals: may split one half-screen into a quarter screen (4 slots)
 *   - 3 terminals: may only split the half-screen that is not split yet (2 slots)
 *   - 4 terminals: full, replacement only
 *   (splittable = leaf depth <= 1: the root leaf or a direct child of the root)
 */

export type SplitDir = 'row' | 'col'; // row = side by side, col = stacked
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
  /** Open mode: classic = classic terminal view; block = block list view (SSH is always classic). */
  openMode?: 'classic' | 'block';
}

export type WindowLayout = PaneTree<{ type: 'leaf'; terminal: TerminalSpec }, 'dir'>;

const terminalSpecSchema = z.object({
  id: z.string().min(1).max(256), kind: z.enum(['local', 'ssh']), shellType: z.string().max(64).optional(),
  cwd: z.string().max(8192).optional(), useProfileDirectory: z.boolean().optional(), openMode: z.enum(['classic', 'block']).optional(),
  ssh: z.object({ name: z.string().max(320), host: z.string().min(1).max(2048), user: z.string().max(256).optional(), port: z.number().int().min(1).max(65535).optional(), connectionId: z.string().max(256).optional() }).passthrough().optional(),
});

/** Validate the terminal wire encoding before converting it into live pane references. */
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
  /** Id of the leaf terminal being split. */
  leafId: string;
  dir: SplitDir;
  position: 'first' | 'second';
  /** Drop rect for the new terminal (0..1, relative to the window). */
  rect: Rect;
}

export interface Divider {
  dir: SplitDir;
  ratio: number;
  /** Ids of the first terminal of the first and of the second subtree (stable identity). */
  aId: string;
  bId: string;
  /** Divider position (relative to the window). */
  rect: Rect;
  /** Region occupied by this split node (relative to the window); nested divider drag ratios are measured against it. */
  region: Rect;
}

/** Minimum vertical space for each terminal pane. */
export const MIN_PANE_SIZE = 135;
/** Keep the command toolbar and composer usable when a pane is narrowed. */
export const MIN_PANE_WIDTH = 360;
/** Divider thickness in px. */
export const DIVIDER_SIZE = 6;

export function leaf(terminal: TerminalSpec): WindowLayout {
  return { type: 'leaf', terminal };
}

export function countLeaves(layout: WindowLayout): number {
  return tree.leaves(layout).length;
}

/** Largest number of terminals in one horizontal row (row adds, col takes the larger side); drives the layout-dependent minimum window width. */
export function maxRowPanes(layout: WindowLayout): number {
  if (layout.type === 'leaf') return 1;
  return layout.dir === 'row'
    ? maxRowPanes(layout.first) + maxRowPanes(layout.second)
    : Math.max(maxRowPanes(layout.first), maxRowPanes(layout.second));
}

/** Minimum width of a window (session container): widest row x per-pane minimum width + divider thickness. */
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

/** Leaf depth: root leaf = 0, direct child of the root = 1, deeper > 1; -1 when not found. */
export function leafDepth(layout: WindowLayout, id: string, depth = 0): number {
  if (layout.type === 'leaf') return layout.terminal.id === id ? depth : -1;
  const d = leafDepth(layout.first, id, depth + 1);
  return d >= 0 ? d : leafDepth(layout.second, id, depth + 1);
}

/** Split a leaf, placing the new terminal in the first or second half of that leaf's region. */
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

/** Replace the terminal inside a leaf. */
export function replaceLeaf(root: WindowLayout, leafId: string, newTerminal: TerminalSpec): WindowLayout {
  return tree.update(root, leafId, () => leaf(newTerminal));
}

/** Remove a leaf; a parent left with a single child is collapsed into that child. */
export function removeLeaf(root: WindowLayout, leafId: string): WindowLayout | null {
  return tree.remove(root, leafId);
}

/** Geometric rect of every leaf (0..1, relative to the window). */
export function leafRects(
  layout: WindowLayout,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
): { terminalId: string; rect: Rect }[] {
  return measureWindowLayout(layout, rect).cells.map(({ id, rect: cell }) => ({ terminalId: id, rect: cell }));
}

/** Dock targets (per the docking rules above). */
export function dropTargets(layout: WindowLayout): DropTarget[] {
  return measureWindowLayout(layout).targets;
}

/**
 * Move targets: every other terminal yields four edge targets (top/bottom/left/right).
 * Unlike splitting (dropTargets) the dragged terminal is removed first, so targets face
 * the remaining terminals only and are not limited by depth <= 1: a terminal may be
 * dropped above, below, left or right of any other terminal.
 */
export function moveTargets(layout: WindowLayout, dragId: string): DropTarget[] {
  // Remove the dragged terminal first so targets are measured against the container after
  // removal, reflecting the final placement instead of the target terminal's current sub-region.
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

/** All dividers (used for rendering and for dragging ratios). */
export function dividers(layout: WindowLayout): Divider[] {
  return measureWindowLayout(layout).dividers;
}

/** Adjust a divider ratio (locating the split node by aId/bId). */
export function setRatio(root: WindowLayout, aId: string, bId: string, ratio: number): WindowLayout {
  return tree.ratio(root, aId, bId, ratio);
}

/** Terminal geometry plus flags for inner borders facing an adjacent terminal (left/right/top/bottom). */
export interface LayoutCell {
  terminalId: string;
  rect: Rect;
  inner: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/**
 * Walk the layout tree and collect every terminal's geometry (0..1, relative to the
 * window) together with its inner border flags. Flat rendering positions all panes at
 * once; drag reordering only changes geometry and never remounts terminal components
 * (a remount closes the PTY and kills a running command).
 */
export function collectLayoutCells(layout: WindowLayout): LayoutCell[] {
  return measureWindowLayout(layout).cells.map(({ id, ...cell }) => ({ terminalId: id, ...cell }));
}
