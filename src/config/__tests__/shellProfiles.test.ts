import { afterEach, expect, it } from 'vitest';
import { useShellProfiles } from '../shellProfiles';
import { useTerminalDefaults } from '../terminalDefaults';
import { firstTerminalOf, useSessionStore } from '@features/workspace';

const snapshot = useSessionStore.getState();
const defaults = useTerminalDefaults.getState();
afterEach(() => { useShellProfiles.setState({ profiles: {} }); useSessionStore.setState(snapshot, true); useTerminalDefaults.setState(defaults, true); });

it('applies profile title and directory while explicit launch values win', () => {
  useShellProfiles.getState().update('bash', { name: 'Build shell', tabTitle: 'Build', cwd: '/build' });
  const store = useSessionStore.getState();
  const id = store.addTab({ shellType: 'bash' });
  const tab = useSessionStore.getState().tabs.find(tab => tab.id === id)!;
  expect(tab.title).toBe('Build');
  expect(firstTerminalOf(tab)?.cwd).toBe('/build');
  const explicit = store.addTab({ shellType: 'bash', cwd: '/chosen', title: 'Chosen' });
  const chosen = useSessionStore.getState().tabs.find(tab => tab.id === explicit)!;
  expect(chosen.title).toBe('Chosen');
  expect(firstTerminalOf(chosen)?.cwd).toBe('/chosen');
});

it('allows an explicit home launch to bypass the profile directory', () => {
  useShellProfiles.getState().update('bash', { cwd: '/build' });
  const id = useSessionStore.getState().addTab({ shellType: 'bash', useProfileDirectory: false });
  expect(firstTerminalOf(useSessionStore.getState().tabs.find(tab => tab.id === id)!)?.cwd).toBeUndefined();
});

it('validates saved profile shapes while keeping supported shells', async () => {
  localStorage.setItem('vrykell-shell-profiles', JSON.stringify({ state: { profiles: { bash: { name: 'Build', cwd: 4, hidden: true }, unknown: { name: 'Invalid' } } }, version: 0 }));
  await useShellProfiles.persist.rehydrate();
  expect(useShellProfiles.getState().profiles).toEqual({ bash: { name: 'Build', cwd: '', tabTitle: '', hidden: true } });
});
