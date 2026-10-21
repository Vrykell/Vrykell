import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
import { useSessionStore } from '../index';
import { useUiStore } from '../stores/ui';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';

beforeEach(() => {
  useSessionStore.setState({ tabs: [{ id: 'terminal', kind: 'session', title: 'Project', layout: {
    type: 'split', dir: 'row', ratio: 0.5,
    first: { type: 'leaf', terminal: { id: 'left', kind: 'local', cwd: '/left' } },
    second: { type: 'leaf', terminal: { id: 'right', kind: 'local', cwd: '/right' } },
  } }], activeId: 'terminal', terminalCwds: { right: '/right/current' }, lastLocalPaneId: null });
  useTerminalStore.setState({ focusedPaneId: 'right', sessions: { left: 'pty-left', right: 'pty-right' } });
  useHarnessWorkspace.setState({ connections: [], selected: '' });
});

it('keeps one workspace page and separate internal connections with the focused directory', () => {
  const workspace = useSessionStore.getState();
  workspace.openHarnessTab('Agent A');
  workspace.openHarnessTab('Agent B', '/other');
  workspace.openHarnessTab('Agent A');
  expect(useSessionStore.getState().tabs.filter(tab => tab.kind === 'harness')).toHaveLength(1);
  const sessions = useHarnessWorkspace.getState();
  expect(sessions.connections.map(item => [item.harness, item.cwd])).toEqual([
    ['Agent A', '/right/current'], ['Agent B', '/other'],
  ]);
  expect(sessions.selected).toBe(sessions.connections[0].id);
});

it('never uses an SSH directory as a local project', () => {
  useSessionStore.setState({ tabs: [{ id: 'remote', title: 'Remote', kind: 'session', layout: {
    type: 'leaf', terminal: { id: 'remote-pane', kind: 'ssh', cwd: '/remote-only' },
  } }], activeId: 'remote', terminalCwds: {}, lastLocalPaneId: null });
  useTerminalStore.setState({ focusedPaneId: 'remote-pane', sessions: { 'remote-pane': 'remote-pty' } });
  useSessionStore.getState().openHarnessTab('Agent A');
  expect(useHarnessWorkspace.getState().connections[0].cwd).toBe('');
});

it('workspace navigation leaves the settings screen', () => {
  useUiStore.getState().setSettingsOpen(true);
  useSessionStore.getState().openUsageTab();
  expect(useUiStore.getState().settingsOpen).toBe(false);
  useUiStore.getState().setSettingsOpen(true);
  useSessionStore.getState().activate('terminal');
  expect(useUiStore.getState().settingsOpen).toBe(false);
});
