import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useHarnessStore } from '../stores/harness';
import { useHarnessSessionRefs } from '../stores/harnessSessions';
import { acpOpen } from '@platform/api/acp';

vi.mock('@platform/api/acp', () => ({
  onAcpSession: vi.fn(async () => () => {}),
  acpOpen: vi.fn(async () => ({
    sessionId: 'runtime-one', resumeSessionId: 'remote-one', harness: 'Agent', cwd: '/project',
    agent: { protocolVersion: 1, agentInfo: null, agentCapabilities: null, authMethods: [] },
    modes: null, models: null, configOptions: null,
  })),
  acpClose: vi.fn(async () => undefined),
}));

beforeEach(() => {
  useHarnessWorkspace.setState({ connections: [], selected: '' });
  useHarnessStore.setState({ byTab: {} });
  useHarnessSessionRefs.setState({ refs: {} });
  vi.mocked(acpOpen).mockClear();
});
afterEach(() => {
  useHarnessWorkspace.getState().close(useHarnessWorkspace.getState().connections.map(item => item.id));
});

it.each(['', '/project'])('creates independent fresh connections in the same directory: %s', cwd => {
  const first = useHarnessWorkspace.getState().connect('Agent', cwd);
  const second = useHarnessWorkspace.getState().connect('Agent', cwd);
  expect(second).not.toBe(first);
  expect(useHarnessWorkspace.getState().connections).toMatchObject([
    { id: first, harness: 'Agent', cwd, fresh: true },
    { id: second, harness: 'Agent', cwd, fresh: true },
  ]);
  expect(useHarnessWorkspace.getState().selected).toBe(second);
});

it('does not implicitly load the remembered conversation when launching another agent', async () => {
  useHarnessSessionRefs.getState().remember('Agent', { sessionId: 'remembered', cwd: '/project', at: 1 });
  const id = useHarnessWorkspace.getState().connect('Agent', '/project');
  const connection = useHarnessWorkspace.getState().connections[0];
  await useHarnessStore.getState().open(id, connection.harness, connection.cwd, connection.fresh, connection.resumeSessionId);
  expect(acpOpen).toHaveBeenCalledWith('Agent', '/project', undefined, expect.any(Array));
});

it('focuses an explicitly restored conversation while keeping different histories independent', () => {
  const first = useHarnessWorkspace.getState().connect('Agent', '/project', false, 'history-one');
  const second = useHarnessWorkspace.getState().connect('Agent', '/project', false, 'history-two');
  expect(useHarnessWorkspace.getState().connect('Agent', '/project', false, 'history-one')).toBe(first);
  expect(second).not.toBe(first);
  expect(useHarnessWorkspace.getState().connections).toHaveLength(2);
  expect(useHarnessWorkspace.getState().selected).toBe(first);
});

it('finds a newly opened live conversation by the remote identity and resolved directory', async () => {
  const id = useHarnessWorkspace.getState().connect('Agent');
  await useHarnessStore.getState().open(id, 'Agent', '', true);
  expect(useHarnessWorkspace.getState().connect('Agent', '/project', false, 'remote-one')).toBe(id);
  expect(useHarnessWorkspace.getState().connections).toHaveLength(1);
  expect(useHarnessWorkspace.getState().connect('Other agent', '/project', false, 'remote-one')).not.toBe(id);
});

it('creates a fresh session even if a historical identity was also provided', () => {
  const id = useHarnessWorkspace.getState().connect('Agent', '/project', true, 'history-one');
  expect(useHarnessWorkspace.getState().connections.find(item => item.id === id)).toMatchObject({ fresh: true });
  expect(useHarnessWorkspace.getState().connections[0].resumeSessionId).toBeUndefined();
});
