import { useDockStore, useSessionStore, useUiStore, useNavigationDrag, useNavigationButtonDrag, type DockSide } from '@features/workspace';
import DockButton from './DockButton';
import { useToastStore } from '@ui/Toast';
import NavigationDragPreview from './NavigationDragPreview';
import { Fragment } from 'react';
import { dismissSshStatus, useSshStatusOwner } from '../hooks/useAuxiliarySidebar';

/** Navigation order and sidebar placement share one persisted source of truth. */
export default function DockNavigation({ side }: { side: DockSide }) {
  const zone = useDockStore(state => side === 'left' ? state.leftZone : state.rightZone);
  const panels = useDockStore(state => side === 'left' ? state.leftPanels : state.rightPanels);
  const sshStatusOwner = useSshStatusOwner();
  const settingsActive = useUiStore(state => state.settingsOpen);
  const dragging = useNavigationDrag(state => state.id);
  const target = useNavigationDrag(state => state.target);
  // The settings page action is pinned below the left toolbar instead of this draggable zone.
  const ids = zone.filter(id => id !== 'settings');
  const compact = side === 'right' && ids.length > 1;

  const startDrag = useNavigationButtonDrag();
  const open = (id: string) => {
    useUiStore.getState().setSettingsOpen(false);
    const dock = useDockStore.getState();
    if (sshStatusOwner && (side === 'right' || window.innerWidth <= 860)) {
      dismissSshStatus();
      dock.openPanel(id);
      return;
    }
    const wasOpen = dock.leftPanels.includes(id) || dock.rightPanels.includes(id);
    if (settingsActive && wasOpen) return;
    dock.togglePanel(side, id);
    const next = useDockStore.getState();
    if (!wasOpen && !next.leftPanels.includes(id) && !next.rightPanels.includes(id)) {
      useToastStore.getState().addToast('窗口空间不足，请加宽窗口或减少分屏', 'info');
    }
  };

  return (
    <nav className={side === 'left' ? 'workspace-activity-bar' : 'workspace-right-navigation'}
      aria-label={side === 'left' ? '工作区导航' : '右侧面板导航'}
      data-dock-zone={side} data-dragging={!!dragging} data-compact={compact}
      data-drop-active={!!dragging && target?.side === side}>
      <div className={side === 'left' ? 'workspace-activity-actions' : 'workspace-right-actions'}>
        {ids.map(id => {
          const index = zone.indexOf(id);
          const active = panels.includes(id) && !(sshStatusOwner && (side === 'right' || window.innerWidth <= 860));
          const showPlaceholder = !!dragging && !target?.openPanel && target?.side === side && target.index === index;
          return (
            <Fragment key={id}>
              {showPlaceholder && <div className="workspace-navigation-placeholder" data-dock-placeholder={target.index} aria-hidden="true" />}
              <div className="workspace-navigation-slot" data-dock-slot={id} data-moving={dragging === id}>
                <DockButton panelId={id} side={side} active={active} onClick={() => open(id)} onPointerDown={event => startDrag(event, id)} />
              </div>
            </Fragment>
          );
        })}
        {!!dragging && !target?.openPanel && target?.side === side && target.index >= ids.length && <div className="workspace-navigation-placeholder" data-dock-placeholder={target.index} aria-hidden="true" />}
      </div>
      {side === 'left' && (
        <div className="workspace-activity-footer">
          <DockButton panelId="settings" side="left" fixed active={settingsActive}
            onClick={() => settingsActive ? useUiStore.getState().setSettingsOpen(false) : useSessionStore.getState().openSettings()} />
        </div>
      )}
      {side === 'left' && <NavigationDragPreview />}
    </nav>
  );
}
