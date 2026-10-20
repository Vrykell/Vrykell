import type { GitSelection } from '@core/git';
import { openFile, loadFileOpenConfig, remoteOpenCommand, openPreferredFile } from '@features/files';
import { useSessionStore, terminalsOf } from '@features/workspace';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { ptyWrite } from '@platform/pty';
import { t } from '@i18n';

export async function openGitFile(selection: GitSelection): Promise<void> {
  const path = `${selection.target.cwd.replace(/[\\/]$/, '')}/${selection.path}`;
  await openPreferredFile({ path, connectionId: selection.target.connectionId }, () => openGitFileInTerminal(selection));
}

async function openGitFileInTerminal(selection: GitSelection): Promise<void> {
  const store = useSessionStore.getState();
  const path = `${selection.target.cwd.replace(/[\\/]$/, '')}/${selection.path}`;
  const title = selection.path.split('/').pop() || selection.path;
  let command = '';
  let tabId: string;
  if (selection.target.connectionId) {
    const spec = store.tabs.flatMap(terminalsOf).find(pane => pane.kind === 'ssh' && pane.ssh?.connectionId === selection.target.connectionId);
    if (!spec?.ssh) throw new Error(t('Open a terminal for this remote connection first.'));
    command = remoteOpenCommand(loadFileOpenConfig(), path);
    tabId = store.addTab({ kind: 'ssh', ssh: spec.ssh, cwd: selection.target.cwd, title });
  } else {
    const result = await openFile(path, value => { command = value; });
    if (result.via === 'system' || !command) return;
    tabId = store.addTab({ cwd: selection.target.cwd, title });
  }
  const sessionId = await waitForTerminalStartup(`${tabId}#0`);
  await ptyWrite(sessionId, command.endsWith('\n') ? command : `${command}\n`);
}
