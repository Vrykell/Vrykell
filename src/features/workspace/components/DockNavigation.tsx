import { Fragment, useEffect, useState } from 'react';
import { t } from '@i18n';
import { useDockStore, useUiStore, useNavigationDrag, useNavigationButtonDrag, type DockSide } from '@features/workspace';
import ContextMenu, { type MenuAnchor } from '@ui/ContextMenu';
import { IconButton } from '@ui/IconButton';
import { MoreHorizontal, iconSizes } from '@ui/icons';
import { useToastStore } from '@ui/Toast';
import { dismissSshStatus, useSshStatusOwner } from '../hooks/useAuxiliarySidebar';
import DockButton from './DockButton';

/**
 * The right auxiliary dock keeps its ordered button row. The left dock holds a single panel
 * with its own heading (and close button), so it never renders this row.
 */
export default function DockNavigation({ side }: { side: DockSide }) {
  const zone = useDockStore(state => state.rightZone);
  const panels = useDockStore(state => state.rightPanels);
  const sshStatusOwner = useSshStatusOwner();
  const settingsActive = useUiStore(state => state.settingsOpen);
  const dragging = useNavigationDrag(state => state.id);
  const target = useNavigationDrag(state => state.target);
  const startDrag = useNavigationButtonDrag();
  const [compact, setCompact] = useState(window.innerWidth <= 760);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth <= 760);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const preferred = compact ? [...panels, ...zone.filter(id => !panels.includes(id))].slice(0, 2) : zone;
  const visible = zone.filter(id => preferred.includes(id));
  const overflow = zone.filter(id => !preferred.includes(id));
  const open = (id: string) => {
    useUiStore.getState().setSettingsOpen(false);
    const dock = useDockStore.getState();
    if (sshStatusOwner) { dismissSshStatus(); dock.openPanel(id); return; }
    const wasOpen = panels.includes(id);
    if (settingsActive && wasOpen) return;
    dock.togglePanel(side, id);
    if (!wasOpen && ![...useDockStore.getState().leftPanels, ...useDockStore.getState().rightPanels].includes(id)) {
      useToastStore.getState().addToast(t('Not enough space. Widen the window or reduce terminal splits.'), 'info');
    }
  };
  if (side === 'left') return null;
  return <nav className="workspace-right-navigation" aria-label={t('Auxiliary panels')} data-dock-zone={side}
    data-dragging={!!dragging} data-compact={zone.length > 1} data-drop-active={!!dragging && target?.side === side}>
    <div className="workspace-right-actions">
      {visible.map(id => <Fragment key={id}>
        {!!dragging && !target?.openPanel && target?.side === side && target.index === zone.indexOf(id)
          && <div className="workspace-navigation-placeholder" data-dock-placeholder={zone.indexOf(id)} aria-hidden="true" />}
        <div className="workspace-navigation-slot" data-dock-slot={id} data-moving={dragging === id}>
          <DockButton panelId={id} side={side} active={panels.includes(id) && !sshStatusOwner} onClick={() => open(id)} onPointerDown={event => startDrag(event, id)} />
        </div>
      </Fragment>)}
      {!!dragging && !target?.openPanel && target?.side === side && target.index >= zone.length
        && <div className="workspace-navigation-placeholder" data-dock-placeholder={target.index} aria-hidden="true" />}
      {!!overflow.length && <IconButton compact data-testid="auxiliary-more" aria-label={t('More panels')} data-tip={t('More panels')} aria-haspopup="menu" aria-expanded={!!menu}
        onClick={event => { const trigger = event.currentTarget; const box = trigger.getBoundingClientRect(); setMenu(menu ? null : { x: box.left, y: box.bottom, trigger }); }}><MoreHorizontal size={iconSizes.control} /></IconButton>}
      {menu && <ContextMenu anchor={menu} label={t('Auxiliary panels')} items={overflow.map(id => ({ label: t(`dock.${id}`), checked: panels.includes(id), onClick: () => open(id) }))} onClose={() => setMenu(null)} />}
    </div>
  </nav>;
}
