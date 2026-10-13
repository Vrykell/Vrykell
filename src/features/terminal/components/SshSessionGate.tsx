import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@i18n';
import ErrorBox from '@ui/ErrorBox';
import Select from '@ui/Select';
import { useSessionStore } from '@features/workspace';
import { findLeaf, replaceLeaf } from '@features/workspace/model/windowLayout';
import { connectionTarget, listSshConnections, type SshConnection } from '@features/ssh/services/api';
import { useTerminalStore } from '@features/terminal';
import { isTerminalDebugEnabled, terminalDebug } from '../services/terminalDebug';

/** Validate saved connection references before starting an authentication session. */
export default function SshSessionGate({ connectionId, paneId, tabId, children }: {
  connectionId: string; paneId: string; tabId: string; children: ReactNode;
}) {
  const [connections, setConnections] = useState<SshConnection[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setConnections(null); setError('');
    void listSshConnections().then(items => {
      if (!active) return;
      setConnections(items); setSelected(items[0]?.id ?? '');
      const present = items.some(item => item.id === connectionId);
      if (!present) useTerminalStore.getState().setStartupState(paneId, 'failed');
      if (isTerminalDebugEnabled()) {
        // The gate renders the recovery panel (not the terminal) while it loads.
        // A "present: true" after a temporary false would unmount the terminal
        // panel and restart SSH authentication from scratch.
        terminalDebug('ssh-gate-resolved', { paneId, connectionId, count: items.length, present });
      }
    }).catch(reason => { if (active) { setError(String(reason)); useTerminalStore.getState().setStartupState(paneId, 'failed'); } });
    return () => { active = false; };
  }, [connectionId, paneId, attempt]);
  if (connections?.some(item => item.id === connectionId)) return children;
  const replaceConnection = (connection?: SshConnection) => {
    const workspace = useSessionStore.getState();
    const tab = workspace.tabs.find(tab => tab.id === tabId);
    if (tab?.kind !== 'session') return;
    const original = findLeaf(tab.layout, paneId);
    if (!original?.ssh) return;
    const ssh = connection ? connectionTarget(connection) : { ...original.ssh, connectionId: undefined };
    workspace.setWindowLayout(tabId, replaceLeaf(tab.layout, paneId, { ...original, ssh }));
  };
  return <div data-testid="ssh-session-recovery" style={{ padding: 24, maxWidth: 600 }}>
    {!connections && !error ? <div role="status">{t('Checking saved connection…')}</div>
      : <ErrorBox tone={error ? 'error' : 'info'} title={t(error ? 'Could not load SSH connections' : 'Saved SSH connection was deleted')}
        details={error || undefined} actions={<>
          {connections && connections.length > 0 && <>
            <Select aria-label={t('Replacement SSH connection')} value={selected}
              options={connections.map(item => ({ value: item.id, label: item.name }))} onChange={setSelected} />
            <button className="ssh-recovery-action" onClick={() => replaceConnection(connections.find(item => item.id === selected))}>{t('Use selected connection')}</button>
          </>}
          <button className="ssh-recovery-action" onClick={() => replaceConnection()}>{t('Connect using saved address')}</button>
          {error && <button className="ssh-recovery-action" onClick={() => setAttempt(value => value + 1)}>{t('Retry')}</button>}
        </>}>
        {t('Choose another connection or reconnect to the saved address with fresh authentication.')}
      </ErrorBox>}
  </div>;
}
