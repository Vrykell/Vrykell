import { useState, type ReactNode } from 'react';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from './ContextMenu';
import { IconButton } from './IconButton';
import { Ellipsis, iconSizes } from './icons';
import { t } from '@i18n';

/** The overflow stays available when secondary toolbar actions do not fit. */
export default function EditorActions({ children, items }: { children?: ReactNode; items: ContextMenuItem[] }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  return <>{children}<IconButton compact aria-label={t('More editor actions')} data-tip={t('More editor actions')} aria-haspopup="menu" aria-expanded={!!menu}
    onClick={event => { const trigger = event.currentTarget; const rect = trigger.getBoundingClientRect(); setMenu({ x: rect.right, y: rect.bottom, trigger }); }}><Ellipsis size={iconSizes.control} /></IconButton>
    {menu && <ContextMenu anchor={menu} label={t('More editor actions')} items={items} onClose={() => setMenu(null)} />}</>;
}
