import { t } from '@i18n';
import SidebarItem from '@ui/sidebarItem';
import { Ellipsis } from '@ui/icons';
import CopyButton from '@ui/CopyButton';
import { ListReorderPlaceholder } from '@ui/listReorder';
import type { CommandItem } from '../model/commands';
import type { MouseEvent, PointerEvent } from 'react';

export default function HistoryCommandRow({ item, active, selected, detailsId, showCount, listId, onFill, onDoubleClick, onMenu, onDrag, onSelect, onCloseDetails }: {
  item: CommandItem; active: boolean; selected: boolean; detailsId: string; showCount: boolean; listId: string;
  onFill: () => void; onDoubleClick: () => void; onMenu: (event: MouseEvent<HTMLElement>) => void;
  onDrag: (event: PointerEvent<HTMLElement>) => void;
  onSelect: () => void; onCloseDetails: () => void;
}) {
  const state = item.runCount === 0 ? t('Not run') : item.status === 'success' ? t('Succeeded') : item.status === 'failed' ? t('Failed') : item.status === 'running' ? t('Running') : t('Unknown');
  const description = [item.cwd, item.shell, item.status ? state : '', item.runCount ? t('{{count}} runs', { count: item.runCount }) : '',
    item.timestamp ? new Date(item.timestamp).toLocaleString() : ''].filter(Boolean).join(' · ');
  return <>
    <ListReorderPlaceholder listId={listId} itemId={item.id} />
    <SidebarItem variant="command"
      title={item.name} titleFontFamily={item.name !== item.command ? 'var(--font-ui)' : 'var(--font-mono)'}
      active={active} tooltip={`${item.command}\n${description}`} tabIndex={0}
      badge={showCount ? <span className="command-history-count" data-tip={t('{{count}} runs', { count: item.runCount ?? 0 })}>{item.runCount ?? 0}</span>
        : item.status === 'failed' || item.status === 'running' ? <span className="command-history-status" data-status={item.status} data-tip={state} role="img" aria-label={state} /> : undefined}
      dataAttributes={{ 'data-command-history': item.id, 'aria-current': selected ? 'true' : undefined, 'aria-controls': selected ? detailsId : undefined }} testId={`command-history-${item.id}`}
      onClick={onSelect} onDoubleClick={onDoubleClick} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu(event); }}
      onKeyDown={event => { if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); onFill(); }
        if (event.key === 'ArrowRight') { event.preventDefault(); onSelect(); }
        if (event.key === 'ArrowLeft' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseDetails(); }
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('.sidebar-row-action')?.click(); }
      }}
      reorderItemId={item.id} reorderKind="command-history"
      reorderListId={listId}
      onPointerDown={onDrag}
      trailingActions={[
        { label: t('Copy command'), control: <CopyButton quiet text={item.command} label={t('Copy command')} style={{ width: 24, height: 24 }} /> },
      ]}
      action={{ icon: <Ellipsis size={16} />, label: t('Command actions'), onClick: onMenu }} />
    <ListReorderPlaceholder listId={listId} itemId={item.id} after />
  </>;
}
