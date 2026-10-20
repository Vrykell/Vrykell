import type { GitEntry } from '@core/git';

export interface ChangeTreeNode { name: string; path: string; entry?: GitEntry; children: ChangeTreeNode[] }
export function changeTree(entries: GitEntry[]): ChangeTreeNode[] {
  const roots: ChangeTreeNode[] = [];
  for (const entry of entries) {
    let nodes = roots;
    const parts = entry.path.split('/');
    let path = '';
    parts.forEach((name, index) => {
      path = path ? `${path}/${name}` : name;
      let node = nodes.find(item => item.name === name);
      if (!node) { node = { name, path, children: [] }; nodes.push(node); }
      if (index === parts.length - 1) node.entry = entry;
      nodes = node.children;
    });
  }
  const sort = (nodes: ChangeTreeNode[]): ChangeTreeNode[] => nodes.sort((a, b) => Number(!!a.entry) - Number(!!b.entry) || a.name.localeCompare(b.name)).map(node => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}
