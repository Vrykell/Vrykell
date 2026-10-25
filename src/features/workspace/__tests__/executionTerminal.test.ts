import { beforeEach, expect, it, vi } from 'vitest';
import { createExecutionTerminal } from '../services/executionTerminal';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
beforeEach(() => {
  useHarnessWorkspace.setState({ connections: [{ id: 'connection', harness: 'Agent', cwd: '/work', fresh: true }], selected: 'connection' });
  useWorkspaceStore.setState({ tabs: [{ id: 'agent', kind: 'harness', title: 'Agent' }], activeId: 'agent' });
});
it.each(['ai', 'unified'] as const)('creates an execution terminal without replacing the %s conversation', area => {
  useWorkspaceNavigation.setState({ area, aiPlacement: 'side' });
  const paneId = createExecutionTerminal({ id: '', kind: 'local', shellType: 'bash', cwd: '/work' });
  expect(paneId).toBeTruthy();
  expect(useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'session')).toMatchObject({ layout: { terminal: { id: paneId, shellType: 'bash', cwd: '/work' } } });
  expect(useWorkspaceStore.getState().activeId).toBe('agent');
  expect(useWorkspaceNavigation.getState()).toMatchObject({ area, aiPlacement: 'side' });
});
