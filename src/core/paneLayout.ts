export interface PaneRect { x: number; y: number; w: number; h: number }
export interface PaneEdges { left: boolean; right: boolean; top: boolean; bottom: boolean }
export interface PaneTarget { leafId: string; dir: 'row' | 'col'; position: 'first' | 'second'; rect: PaneRect }
type Description<Node> = { id: string } | { dir: 'row' | 'col'; ratio: number; first: Node; second: Node };

export function measurePaneTree<Node>(root: Node, describe: (node: Node) => Description<Node>, initial: PaneRect = { x: 0, y: 0, w: 1, h: 1 }) {
  const cells: { id: string; rect: PaneRect; inner: PaneEdges }[] = [];
  const dividers: { aId: string; bId: string; dir: 'row' | 'col'; ratio: number; rect: PaneRect; region: PaneRect }[] = [];
  const targets: PaneTarget[] = [];
  const firstId = (node: Node): string => { const value = describe(node); return 'id' in value ? value.id : firstId(value.first); };
  const halves = (rect: PaneRect, dir: 'row' | 'col', ratio: number): [PaneRect, PaneRect] => dir === 'row'
    ? [{ ...rect, w: rect.w * ratio }, { ...rect, x: rect.x + rect.w * ratio, w: rect.w * (1 - ratio) }]
    : [{ ...rect, h: rect.h * ratio }, { ...rect, y: rect.y + rect.h * ratio, h: rect.h * (1 - ratio) }];
  const walk = (node: Node, rect: PaneRect, inner: PaneEdges, depth: number, parentDir?: 'row' | 'col') => {
    const value = describe(node);
    if ('id' in value) {
      cells.push({ id: value.id, rect, inner });
      if (depth <= 1) for (const dir of (parentDir ? [parentDir === 'row' ? 'col' : 'row'] : ['row', 'col']) as ('row' | 'col')[]) {
        const [first, second] = halves(rect, dir, 0.5);
        targets.push({ leafId: value.id, dir, position: 'first', rect: first }, { leafId: value.id, dir, position: 'second', rect: second });
      }
      return;
    }
    const ratio = Math.max(0, Math.min(1, value.ratio)); const row = value.dir === 'row';
    const [first, second] = halves(rect, value.dir, ratio);
    dividers.push({ dir: value.dir, ratio, aId: firstId(value.first), bId: firstId(value.second), region: rect,
      rect: row ? { x: second.x, y: rect.y, w: 0, h: rect.h } : { x: rect.x, y: second.y, w: rect.w, h: 0 } });
    walk(value.first, first, row ? { ...inner, right: true } : { ...inner, bottom: true }, depth + 1, value.dir);
    walk(value.second, second, row ? { ...inner, left: true } : { ...inner, top: true }, depth + 1, value.dir);
  };
  walk(root, initial, { left: false, right: false, top: false, bottom: false }, 0);
  return { cells, dividers, targets };
}
