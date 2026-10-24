import { useState } from 'react';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '@ui/menus/ContextMenu';
import { IconButton } from '@ui/actions/IconButton';
import { ChevronDown, iconSizes } from '@ui/icons';
import { t } from '@i18n';

/** The overflow stays available when secondary toolbar actions do not fit. */
export default function EditorActions({ items, label = t('More editor actions') }: { items: ContextMenuItem[]; label?: string }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  return <><IconButton className="folder-more-button" aria-label={label} data-tip={label} aria-haspopup="menu" aria-expanded={!!menu}
    onClick={event => { const trigger = event.currentTarget; const rect = trigger.getBoundingClientRect(); setMenu(current => current ? null : { x: rect.left, y: rect.bottom, trigger }); }}><ChevronDown size={iconSizes.control} /></IconButton>
    {menu && <ContextMenu itemRole="menuitem" anchor={menu} label={label} items={items} onClose={() => setMenu(null)} />}</>;
}
