import { useSessionStore } from '@features/workspace';
import { useUiStore, useDockStore } from '@features/workspace';
import { diagnosticsLogPath } from '@platform/diagnostics';
import { openPath } from '@tauri-apps/plugin-opener';
import { clearSessionBlocks } from '@features/terminal/hooks/useTerminalSession';
import { isTerminalDebugEnabled, setTerminalDebugEnabled } from '@features/terminal/services/terminalDebug';
import { useToastStore } from '@ui/feedback/Toast';
import { redrawTerminal } from '@features/terminal/services/terminalRepaint';
import { t } from '@i18n';
import { isMacOS } from '@platform/runtime';
import { closeWorkspaceItem } from '@features/workspace/services/closeWorkspaceItem';
import { newWorkspaceItem } from '@features/workspace/services/workspaceActions';

/** Application command definition, shared by the command palette and global search. */
export interface AppCommand {
  id: string;
  label: string;
  desc: string;
  keys?: string;
  keywords?: string[]; // Extra search keywords.
  action: () => void;
}

/** Registered commands (singleton). */
const _commands: AppCommand[] = [];

/** Register one command. */
export function registerCommand(cmd: AppCommand) {
  if (!_commands.some((c) => c.id === cmd.id)) {
    _commands.push(cmd);
  }
}

/** All registered commands. */
export function getCommands(): AppCommand[] {
  return _commands;
}

/** Filter commands by query. */
export function searchCommands(query: string): AppCommand[] {
  const lower = query.toLowerCase();
  return _commands.filter(
    (c) =>
      c.label.toLowerCase().includes(lower) ||
      c.desc.toLowerCase().includes(lower) ||
      (c.keywords?.some((k) => k.toLowerCase().includes(lower)) ?? false),
  );
}

// Command registration.

function getActiveId() {
  return useSessionStore.getState().activeId;
}

registerCommand({ id: 'new-tab', label: t('New tab'), desc: t('Create an instance in the current workspace'), keys: '⌘T', keywords: ['tab', 'new'], action: () => newWorkspaceItem() });
registerCommand({ id: 'close-tab', label: t('Close current tab'), desc: t('Close the active tab'), keys: '⌘W', keywords: ['close', 'tab'], action: () => closeWorkspaceItem() });
registerCommand({ id: 'undo-close-tab', label: t('Restore closed tab'), desc: t('Undo the last tab close'), keys: '⌘⇧T', keywords: ['undo', 'tab', 'restore'], action: () => useSessionStore.getState().undoCloseTab() });
registerCommand({ id: 'toggle-files', label: t('Toggle file panel'), desc: t('Show or hide the file panel according to the navigation layout'), keywords: ['files', 'panel'], action: () => useDockStore.getState().togglePanel('left', 'files') });
registerCommand({ id: 'open-settings', label: t('Open settings'), desc: t('Configure API keys, models and the editor'), keys: '⌘,', keywords: ['settings', 'config', 'api'], action: () => useSessionStore.getState().openSettings() });
registerCommand({ id: 'clear-blocks', label: t('Clear output blocks'), desc: t('Clear every command block in the current tab'), keywords: ['clear', 'reset'], action: () => clearSessionBlocks(getActiveId()) });
registerCommand({ id: 'redraw-terminal', label: t('Redraw terminal'), desc: t('Refresh the terminal display while keeping the running session'), keys: isMacOS ? 'Meta+Shift+R' : 'Control+Shift+R', keywords: ['redraw', 'repaint', 'refresh', 'terminal'], action: () => redrawTerminal() });
registerCommand({ id: 'toggle-terminal-debug', label: t('Toggle terminal diagnostics log'), desc: t('Turn PTY, shell integration and session state logging on or off'), keywords: ['terminal', 'debug', 'log', 'pty'], action: () => {
  const enabled = setTerminalDebugEnabled(!isTerminalDebugEnabled());
  useToastStore.getState().addToast(enabled ? t('Terminal diagnostics log enabled') : t('Terminal diagnostics log disabled'), 'info');
} });
registerCommand({ id: 'open-terminal-debug-log', label: t('Open terminal diagnostics log'), desc: t('View PTY, shell integration and session state records'), keywords: ['terminal', 'debug', 'log', 'pty'], action: () => {
  void diagnosticsLogPath()
    .then((path) => openPath(path))
    .catch(() => useToastStore.getState().addToast(t('Could not open the terminal diagnostics log'), 'error'));
} });
registerCommand({ id: 'global-search', label: t('Global search'), desc: t('Search files, commands, settings and more'), keys: '⌘F', keywords: ['search', 'find'], action: () => useUiStore.getState().setGlobalSearchOpen(true) });
registerCommand({ id: 'command-history', label: t('Command history'), desc: t('Browse, save and write commands for the current project'), keywords: ['history', 'project', 'build', 'run', 'commands'], action: () => useDockStore.getState().openPanel('command-history') });
