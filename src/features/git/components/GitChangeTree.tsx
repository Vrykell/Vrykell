import { useState, type ReactNode } from 'react';
import type { GitEntry } from '@core/git';
import SidebarItem from '@ui/layout/sidebarItem';
import { Folder } from '@ui/icons';
import { changeTree, type ChangeTreeNode } from '../model/tree';

export default function GitChangeTree({ entries, renderEntry }: { entries: GitEntry[]; renderEntry: (entry: GitEntry, depth: number) => ReactNode }) {
  const [folded, setFolded] = useState<string[]>([]);
  const toggle = (path: string) => setFolded(values => values.includes(path) ? values.filter(value => value !== path) : [...values, path]);
  const render = (node: ChangeTreeNode, depth: number): ReactNode => node.entry ? renderEntry(node.entry, depth) : <div key={node.path}>
    <SidebarItem variant="resource" compact active={false} title={node.name} tooltip={node.path}
      tree={{ depth, expanded: !folded.includes(node.path), onToggle: () => toggle(node.path) }} icon={<Folder size={18} />}
      dataAttributes={{ 'aria-expanded': String(!folded.includes(node.path)) }} tabIndex={0}
      onClick={() => toggle(node.path)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (['Enter', ' '].includes(event.key) || (event.key === 'ArrowRight' && folded.includes(node.path)) || (event.key === 'ArrowLeft' && !folded.includes(node.path))) { event.preventDefault(); toggle(node.path); }
      }} />
    {!folded.includes(node.path) && node.children.map(child => render(child, depth + 1))}
  </div>;
  return <>{changeTree(entries).map(node => render(node, 0))}</>;
}
