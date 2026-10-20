import type { EditorFile } from '@core/editor';
import { useSessionStore, terminalsOf } from '@features/workspace';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { ptyWrite } from '@platform/pty';
import { parentOf } from '@platform/path';
import { openFile, loadConfig, remoteOpenCommand } from './fileOpen';
import { t } from '@i18n';
import { shellQuote } from '@features/ssh/utils/remotePath';
import { isWindows } from '@platform/runtime';
import { openElevatedEditorFile } from '@platform/api/editor';
export async function openInTerminal(file: EditorFile, elevated = false) {
  if (elevated && !file.connectionId && isWindows) { await openElevatedEditorFile(file); return; }
  const store = useSessionStore.getState(); let command = ''; let tabId: string;
  const name = file.path.split('/').pop() || file.path;
  const title = elevated ? t('Elevated: {{name}}', { name }) : name;
  if (file.connectionId) {
    const spec = store.tabs.flatMap(terminalsOf).find(pane => pane.kind === 'ssh' && pane.ssh?.connectionId === file.connectionId);
    if (!spec?.ssh) throw new Error(t('Open a terminal for this remote connection first.'));
    command = elevated ? `sudoedit -- ${shellQuote(file.path)}\n` : remoteOpenCommand(loadConfig(), file.path); tabId = store.addTab({ kind: 'ssh', ssh: spec.ssh, cwd: parentOf(file.path) ?? '/', title });
  } else {
    if (elevated) command = `sudoedit -- ${shellQuote(file.path)}\n`;
    else { const result = await openFile(file.path, next => { command = next; }); if (result.via === 'system' || !command) return; }
    tabId = store.addTab({ cwd: parentOf(file.path) ?? undefined, title });
  }
  const session = await waitForTerminalStartup(`${tabId}#0`); await ptyWrite(session, command.endsWith('\n') ? command : `${command}\n`);
}
