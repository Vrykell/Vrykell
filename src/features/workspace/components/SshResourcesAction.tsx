import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaves } from '../model/windowLayout';
import { useAuxiliarySidebarStore } from '../stores/auxiliarySidebar';
import { IconBtn } from '@ui/actions/UiBtn';
import { DataUsage, iconSizes } from '@ui/icons';
import { t } from '@i18n';

export default function SshResourcesAction() {
  const focused = useTerminalStore(state => state.focusedPaneId);
  const paneId = useSessionStore(state => {
    const tab = state.tabs.find(tab => tab.id === state.activeId);
    if (tab?.kind !== 'session') return undefined;
    const panes = leaves(tab.layout); const pane = panes.find(item => item.id === focused) ?? panes[0];
    return pane?.kind === 'ssh' ? pane.id : undefined;
  });
  const owner = useAuxiliarySidebarStore(state => state.sshStatusOwner);
  if (!paneId) return null;
  return <IconBtn title={t('SSH resources')} data-testid="tab-ssh-resources" aria-pressed={owner === paneId}
    onClick={() => owner === paneId ? useAuxiliarySidebarStore.getState().dismissSshStatus() : useAuxiliarySidebarStore.getState().requestOpen(paneId)}>
    <DataUsage size={iconSizes.control} />
  </IconBtn>;
}
