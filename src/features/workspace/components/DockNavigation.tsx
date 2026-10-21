import { Fragment } from 'react';
import { t } from '@i18n';
import { useDockStore, useUiStore, useNavigationDrag, useNavigationButtonDrag, type DockSide } from '@features/workspace';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { useToastStore } from '@ui/Toast';
import { dismissSshStatus, useSshStatusOwner } from '../hooks/useAuxiliarySidebar';
import DockButton from './DockButton';

/** Auxiliary actions share one ordered right-hand dock. */
export default function DockNavigation({ side }: { side: DockSide }) {
  const zone = useDockStore(state => state.rightZone);
  const panels = useDockStore(state => state.rightPanels);
  const sshStatusOwner = useSshStatusOwner();
  const settingsActive = useUiStore(state => state.settingsOpen);
  const dragging = useNavigationDrag(state => state.id);
  const target = useNavigationDrag(state => state.target);
  const startDrag = useNavigationButtonDrag();
  const open = (id: string) => {
    useUiStore.getState().setSettingsOpen(false);
    const dock = useDockStore.getState();
    if (id === 'chat') {
      if (!useAiWorkspace.getState().nativeTabs.length && !useAiWorkspace.getState().selected) {
        void useChatStore.getState().loadConversations().then(() => {
          const conversationId = useChatStore.getState().activeConversationId;
          if (conversationId) useAiWorkspace.getState().openNative(conversationId);
        });
      }
    }
    if (sshStatusOwner) { dismissSshStatus(); dock.openPanel(id); return; }
    const wasOpen = dock.rightPanels.includes(id);
    if (settingsActive && wasOpen) return;
    dock.togglePanel('right', id);
    if (!wasOpen && !useDockStore.getState().rightPanels.includes(id)) {
      useToastStore.getState().addToast(t('Not enough space. Widen the window or reduce terminal splits.'), 'info');
    }
  };
  if (side !== 'right') return null;
  return <nav className="workspace-right-navigation" aria-label={t('Auxiliary panels')} data-dock-zone="right"
    data-dragging={!!dragging} data-compact={zone.length > 1} data-drop-active={!!dragging && target?.side === 'right'}>
    <div className="workspace-right-actions">
      {zone.map((id, index) => <Fragment key={id}>
        {!!dragging && !target?.openPanel && target?.side === 'right' && target.index === index
          && <div className="workspace-navigation-placeholder" data-dock-placeholder={index} aria-hidden="true" />}
        <div className="workspace-navigation-slot" data-dock-slot={id} data-moving={dragging === id}>
          <DockButton panelId={id} side="right" active={panels.includes(id) && !sshStatusOwner} onClick={() => open(id)} onPointerDown={event => startDrag(event, id)} />
        </div>
      </Fragment>)}
      {!!dragging && !target?.openPanel && target?.side === 'right' && target.index >= zone.length
        && <div className="workspace-navigation-placeholder" data-dock-placeholder={target.index} aria-hidden="true" />}
    </div>
  </nav>;
}
