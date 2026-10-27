import { useState } from 'react';
import { t } from '@i18n';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { useSessionStore, terminalsOf, useWorkspaceNavigation } from '@features/workspace';
import { presentWorkspaceResource } from '@features/workspace/services/unifiedWorkspace';
import { useTerminalStore } from '@features/terminal';
import { useSshStore } from '../stores/store';
import { connectionTarget, type SshConnection } from '../services/api';
import { useHostEditor } from '../stores/hostEditor';
import SshFormModal from './SshFormModal';
import SshImportModal from './SshImportModal';
import SshDashboard from './SshDashboard';

function openSshConnection(conn: SshConnection) {
  const workspace = useSessionStore.getState();
  const sessions = useTerminalStore.getState().sessions;
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'session') continue;
    const terms = terminalsOf(tab);
    if (!terms.some(term => term.kind === 'ssh' && term.ssh?.connectionId === conn.id)) continue;
    if (terms.some(term => sessions[term.id])) continue;
    workspace.closeTab(tab.id);
  }
  useSshStore.getState().touch(conn.id).catch(() => {});
  const id = useSessionStore.getState().addTab({ kind: 'ssh', ssh: connectionTarget(conn) });
  presentWorkspaceResource(`terminal:${id}#0`);
}

export default function PanelSsh({ active = true }: { active?: boolean }) {
  const editing = useHostEditor(state => state.draft);
  const quickOpen = useHostEditor(state => state.quickOpen);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<SshConnection | null>(null);
  if (editing !== undefined) return <SshFormModal page open initial={editing} onClose={() => useHostEditor.getState().close()} onSaveAndConnect={openSshConnection} />;
  return <>
    <SshDashboard active={active} onForwarding={() => useWorkspaceNavigation.getState().selectArea('forwarding')} onManage={() => useHostEditor.getState().open()} onImport={() => setImportOpen(true)}
      onQuickConnect={() => useHostEditor.getState().setQuickOpen(true)} onDelete={setDeleting} onOpenTerminal={openSshConnection} />
    <SshImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    <SshFormModal open={quickOpen} initial={null} onClose={() => useHostEditor.getState().setQuickOpen(false)} onConnect={connection => {
      const id = useSessionStore.getState().addTab({ kind: 'ssh', ssh: { ...connectionTarget(connection), connectionId: undefined } });
      presentWorkspaceResource(`terminal:${id}#0`);
    }} />
    <ConfirmDialog open={!!deleting} danger title={t('Delete SSH connection?')} message={deleting?.name} confirmLabel={t('Delete')} cancelLabel={t('Cancel')}
      onConfirm={async () => { if (deleting) await useSshStore.getState().remove(deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)} />
  </>;
}
