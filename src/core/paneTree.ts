/** One binary layout model; leaf payloads belong to their resource domain. */
export type PaneTree<Leaf, Direction extends string = 'direction'> = Leaf | ({
  type: 'split'; ratio: number; first: PaneTree<Leaf, Direction>; second: PaneTree<Leaf, Direction>;
} & Record<Direction, 'row' | 'col'>);

export function clampPaneRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(0.2, Math.min(0.8, ratio)) : 0.5;
}

export interface PaneTreeAdapter<Node, Leaf> {
  leaf: (node: Node) => Leaf | null;
  children: (node: Node) => [Node, Node];
  join: (node: Node, first: Node, second: Node) => Node;
  withRatio: (node: Node, ratio: number) => Node;
  id: (leaf: Leaf) => string;
}

/** Algorithms operate on the same tree contract, including persisted older encodings. */
export function paneTreeOperations<Node, Leaf>(adapter: PaneTreeAdapter<Node, Leaf>) {
  const leaves = (node: Node): Leaf[] => {
    const value = adapter.leaf(node);
    return value ? [value] : adapter.children(node).flatMap(leaves);
  };
  const map = (node: Node, apply: (leaf: Leaf, node: Node) => Node | null): Node | null => {
    const value = adapter.leaf(node);
    if (value) return apply(value, node);
    const [a, b] = adapter.children(node);
    const first = map(a, apply); const second = map(b, apply);
    if (first === null) return second;
    if (second === null) return first;
    return first === a && second === b ? node : adapter.join(node, first, second);
  };
  const update = (node: Node, id: string, apply: (node: Node) => Node): Node =>
    map(node, (value, current) => adapter.id(value) === id ? apply(current) : current)!;
  const remove = (node: Node, id: string) => map(node, (value, current) => adapter.id(value) === id ? null : current);
  const ratio = (node: Node, firstId: string, secondId: string, value: number): Node => {
    if (adapter.leaf(node)) return node;
    const [first, second] = adapter.children(node);
    if (adapter.id(leaves(first)[0]!) === firstId && adapter.id(leaves(second)[0]!) === secondId) return adapter.withRatio(node, clampPaneRatio(value));
    const a = ratio(first, firstId, secondId, value); const b = ratio(second, firstId, secondId, value);
    return a === first && b === second ? node : adapter.join(node, a, b);
  };
  return { leaves, map, update, remove, ratio };
}
