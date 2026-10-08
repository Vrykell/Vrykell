import { afterEach, expect, it } from 'vitest';
import { preferredShell, useTerminalDefaults } from '../terminalDefaults';
import { useSessionStore } from '@features/workspace';
import { firstLeaf } from '@features/workspace/model/windowLayout';

const shells = [{ id: 'zsh' as const, label: 'Zsh', default: true }, { id: 'bash' as const, label: 'Bash', default: false }];
afterEach(() => { useTerminalDefaults.getState().setShell('system'); useSessionStore.setState({ tabs: [], activeId: '' }); });
it('prefers the selected installed shell and falls back when it is unavailable', () => {
  expect(preferredShell('bash', shells)).toBe('bash');
  expect(preferredShell('pwsh', shells)).toBe('zsh');
  expect(preferredShell('system', shells)).toBe('zsh');
});
it('persists defaults and uses them for new tabs while explicit choices take precedence', () => {
  useTerminalDefaults.getState().setShell('bash');
  expect(JSON.parse(localStorage.getItem('vrykell-terminal-defaults')!).state.shell).toBe('bash');
  const ws = useSessionStore.getState();
  const id = ws.addTab();
  const tab = useSessionStore.getState().tabs.find(tab => tab.id === id)!;
  expect(tab.kind === 'session' && firstLeaf(tab.layout).shellType).toBe('bash');
  const other = ws.addTab({ shellType: 'zsh' });
  const explicit = useSessionStore.getState().tabs.find(tab => tab.id === other)!;
  expect(explicit.kind === 'session' && firstLeaf(explicit.layout).shellType).toBe('zsh');
});
