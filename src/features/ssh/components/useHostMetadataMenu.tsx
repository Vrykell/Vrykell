import { t } from '@i18n';
import type { ContextMenuItem, MenuAnchor } from '@ui/menus/ContextMenu';
import { writeClipboardText } from '@platform/clipboard';
import { useToastStore } from '@ui/feedback/Toast';
import { useWorkspaceNavigation } from '@features/workspace';
import { useHostLibrary } from '../stores/hostLibrary';
import { useHostEditor } from '../stores/hostEditor';
import { useSshStore } from '../stores/store';
import { newSshId, type SshConnection } from '../services/api';
import { connectionRules, withForwardingRules } from '../services/forwarding';

export function useHostMetadataMenu({ onConnect, onRetry }: { onConnect: (connection: SshConnection) => void; onRetry: (connection: SshConnection) => void }) {
  const hosts = useHostLibrary(state => state.hosts);
  const items = (id: string, _anchor?: MenuAnchor): ContextMenuItem[] => {
    const connection = useSshStore.getState().connections.find(item => item.id === id);
    if (!connection) return [];
    return [
      { label: t('Connect'), onClick: () => onConnect(connection) },
      { label: t('Edit connection'), onClick: () => { useHostEditor.getState().open(connection); useWorkspaceNavigation.getState().selectArea('ssh'); } },
      { label: t('Duplicate host'), onClick: () => {
        const duplicate = duplicateHost(connection);
        void useSshStore.getState().save(duplicate).then(() => { useHostLibrary.getState().update(duplicate.id, { ...hosts[id], starred: false }); }).catch(reason => useToastStore.getState().addToast(String(reason), 'error'));
      } },
      { label: t(hosts[id]?.starred ? 'Unstar host' : 'Star host'), onClick: () => useHostLibrary.getState().update(id, { starred: !hosts[id]?.starred }) },
      { label: t('Copy address'), onClick: () => { void writeClipboardText(`${connection.user ? `${connection.user}@` : ''}${connection.host}:${connection.port ?? 22}`).catch(reason => useToastStore.getState().addToast(String(reason), 'error')); } },
      { label: t('Retry'), group: 'view', onClick: () => onRetry(connection) },
      { label: t(hosts[id]?.resourceDisabled ? 'Read resource usage' : 'Do not read resource usage'), group: 'view', onClick: () => useHostLibrary.getState().update(id, { resourceDisabled: !hosts[id]?.resourceDisabled }) },
    ];
  };
  return { items };
}

export function duplicateHost(connection: SshConnection): SshConnection {
  return { ...withForwardingRules(connection, connectionRules(connection).map(rule => ({ ...rule, id: crypto.randomUUID(), autoStart: false }))), id: newSshId(), name: t('{{name}} copy', { name: connection.name }), password: undefined, hasPassword: false, lastOpenedAt: undefined };
}
