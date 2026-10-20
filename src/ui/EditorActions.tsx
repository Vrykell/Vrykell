import { useState } from 'react';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from './ContextMenu';
import { IconButton } from './IconButton';
import { ChevronDown, iconSizes } from './icons';
import { t } from '@i18n';

/** The overflow stays available when secondary toolbar actions do not fit. */
export default function EditorActions({ items }: { items: ContextMenuItem[] }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  return <><IconButton className="folder-more-button" aria-label={t('More editor actions')} data-tip={t('More editor actions')} aria-haspopup="menu" aria-expanded={!!menu}
    onClick={event => { const trigger = event.currentTarget; const rect = trigger.getBoundingClientRect(); setMenu(current => current ? null : { x: rect.left, y: rect.bottom, trigger }); }}><ChevronDown size={iconSizes.control} /></IconButton>
    {menu && <ContextMenu anchor={menu} label={t('More editor actions')} items={items} onClose={() => setMenu(null)} />}</>;
}
