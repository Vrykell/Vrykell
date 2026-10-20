import { useState } from 'react';
import type { GitEntry, GitScope } from '@core/git';
import { fileIcon } from '@features/files';
import SidebarItem from '@ui/sidebarItem';
import ContextMenu, { type MenuAnchor } from '@ui/ContextMenu';
import { File, Plus, Minus, RotateCcw, Check, iconSizes } from '@ui/icons';
import { t } from '@i18n';

export default function GitChangeRow({ entry, scope, active, busy, compare, open, stage, discard, depth }: {
  entry: GitEntry; scope: GitScope; active: boolean; busy: boolean;
  compare: () => void; open: () => void; stage: () => void; discard: () => void;
  depth?: number;
}) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const Icon = fileIcon(entry.path);
  const actions = [
    { label: t('Open working file'), icon: <File size={14} />, disabled: entry.worktreeStatus === 'D' || entry.indexStatus === 'D', onClick: open },
    ...(scope === 'unstaged' || scope === 'untracked' ? [{ label: t('Discard changes'), icon: <RotateCcw size={14} />, disabled: busy, onClick: discard }] : []),
    ...(scope !== 'conflicts' ? [{ label: t(scope === 'staged' ? 'Unstage file' : 'Stage file'), icon: scope === 'staged' ? <Minus size={14} /> : <Plus size={14} />, disabled: busy, onClick: stage }] : []),
    ...(scope === 'conflicts' ? [{ label: t('Mark as resolved'), icon: <Check size={14} />, disabled: busy, onClick: stage }] : []),
  ];
  return <>
    <SidebarItem variant="resource" compact title={entry.path.split('/').pop() || entry.path}
      subtitle={depth === undefined && entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : undefined}
      tree={depth === undefined ? undefined : { depth }}
      icon={<Icon size={iconSizes.compact} />} tooltip={entry.previousPath ? `${entry.previousPath} → ${entry.path}` : entry.path}
      active={active} testId={`git-${scope}-${entry.path}`} tabIndex={0} onClick={compare}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); compare(); } }}
      onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}
      badge={<span className="git-file-status" data-kind={scope}>{scope === 'untracked' ? 'U' : scope === 'staged' ? entry.indexStatus : entry.worktreeStatus}</span>}
      trailingActions={actions} />
    {menu && <ContextMenu anchor={menu} label={t('File actions')} onClose={() => setMenu(null)} items={actions.map(action => ({ label: action.label, disabled: action.disabled, onClick: action.onClick }))} />}
  </>;
}
