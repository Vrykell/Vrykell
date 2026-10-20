import type { EditorFile } from '@core/editor';
import { useSessionStore, terminalsOf } from '@features/workspace';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { ptyWrite } from '@platform/pty';
import { parentOf } from '@platform/path';
import { openFile, loadConfig, remoteOpenCommand } from './fileOpen';
import { t } from '@i18n';
export async function openInTerminal(file: EditorFile) {
  const store = useSessionStore.getState(); let command = ''; let tabId: string;
  const title = file.path.split('/').pop() || file.path;
  if (file.connectionId) {
    const spec = store.tabs.flatMap(terminalsOf).find(pane => pane.kind === 'ssh' && pane.ssh?.connectionId === file.connectionId);
    if (!spec?.ssh) throw new Error(t('Open a terminal for this remote connection first.'));
    command = remoteOpenCommand(loadConfig(), file.path); tabId = store.addTab({ kind: 'ssh', ssh: spec.ssh, cwd: parentOf(file.path) ?? '/', title });
  } else {
    const result = await openFile(file.path, next => { command = next; }); if (result.via === 'system' || !command) return;
    tabId = store.addTab({ cwd: parentOf(file.path) ?? undefined, title });
  }
  const session = await waitForTerminalStartup(`${tabId}#0`); await ptyWrite(session, command.endsWith('\n') ? command : `${command}\n`);
}
