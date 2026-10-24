/**
 * Harness session state — what the agent publishes beyond the transcript.
 *
 * An ACP agent reports its modes, models and config options with the session, and later pushes the
 * active mode, a whole new configuration, its plan and the context window in use. The page draws
 * those as controls and a plan card, so the store has to keep them next to the messages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHarnessStore } from '@features/chat/stores/harness';
import { useHarnessSessionRefs } from '@features/chat/stores/harnessSessions';
import { acpClose, acpOpen, acpSetConfigOption, acpSetMode, acpSetModel, type HarnessOpenResult } from '@platform/api/acp';

vi.mock('@platform/api/acp', () => ({
  acpAnswerPermission: vi.fn(async () => undefined),
  acpCancel: vi.fn(async () => undefined),
  acpClose: vi.fn(async () => undefined),
  acpOpen: vi.fn(async () => ({
    sessionId: 's1',
    harness: 'Claude Code',
    cwd: '/tmp/project',
    agent: { agentInfo: { name: 'Fake' } },
    modes: {
      currentModeId: 'default',
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'plan', name: 'Plan' },
      ],
    },
    models: {
      currentModelId: 'm1',
      availableModels: [{ modelId: 'm1', name: 'Model One' }, { modelId: 'm2', name: 'Model Two' }],
    },
    configOptions: null,
    replayed: [],
  })),
  acpPrompt: vi.fn(async () => undefined),
  acpSetConfigOption: vi.fn(async () => [
    { id: 'mode', name: 'Mode', type: 'select', category: 'mode', currentValue: 'plan', options: [{ value: 'plan', name: 'Plan' }] },
  ]),
  acpSetMode: vi.fn(async () => undefined),
  acpSetModel: vi.fn(async () => undefined),
  onAcpSession: vi.fn(async () => () => {}),
}));

const TAB = 'tab-state';
const SESSION = 's1';

const notification = (update: Record<string, unknown>) => ({
  kind: 'update',
  sessionId: SESSION,
  payload: { jsonrpc: '2.0', method: 'session/update', params: { sessionId: SESSION, update } },
});

const current = () => useHarnessStore.getState().byTab[TAB]!;

beforeEach(async () => {
  vi.mocked(acpSetMode).mockClear();
  vi.mocked(acpSetModel).mockClear();
  vi.mocked(acpSetConfigOption).mockClear();
  vi.mocked(acpOpen).mockClear();
  useHarnessStore.setState({ byTab: {} });
  useHarnessSessionRefs.setState({ refs: {} });
  await useHarnessStore.getState().open(TAB, 'Claude Code', '/tmp/project');
});

describe('harness session state', () => {
  it('forgets only the requested saved reference without replacing a newer session', () => {
    useHarnessSessionRefs.getState().remember('Agent', { sessionId: 'newer', cwd: '/project', at: 20 });
    useHarnessSessionRefs.getState().forget('Agent', 'older');
    expect(useHarnessSessionRefs.getState().refs.Agent?.sessionId).toBe('newer');
    useHarnessSessionRefs.getState().forget('Agent', 'newer');
    expect(useHarnessSessionRefs.getState().refs.Agent).toBeUndefined();
    expect(useHarnessSessionRefs.getState().refs['Claude Code']).toBeDefined();
  });
  it('keeps the plan, the context window and the active mode the agent publishes', () => {
    const store = useHarnessStore.getState();
    store.applyEvent(notification({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read the failing test', status: 'completed' },
        { content: 'Fix the parser', status: 'in_progress' },
      ],
    }) as never);
    store.applyEvent(notification({ sessionUpdate: 'usage_update', used: 12_000, size: 200_000 }) as never);
    store.applyEvent(notification({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }) as never);

    expect(current().plan).toHaveLength(2);
    expect(current().plan[1]).toMatchObject({ content: 'Fix the parser', status: 'in_progress' });
    expect(current().context).toEqual({ used: 12_000, size: 200_000 });
    expect(current().modes?.currentModeId).toBe('plan');
  });

  it('sends a mode or model switch and moves the control at once', async () => {
    await useHarnessStore.getState().setMode(TAB, 'plan');
    await useHarnessStore.getState().setModel(TAB, 'm2');

    expect(acpSetMode).toHaveBeenCalledWith(SESSION, 'plan');
    expect(acpSetModel).toHaveBeenCalledWith(SESSION, 'm2');
    expect(current().modes?.currentModeId).toBe('plan');
    expect(current().models?.currentModelId).toBe('m2');
  });

  it('takes the whole configuration back from a config option change', async () => {
    await useHarnessStore.getState().setConfigOption(TAB, 'mode', 'plan');

    expect(acpSetConfigOption).toHaveBeenCalledWith(SESSION, 'mode', 'plan');
    expect(current().configOptions?.[0]).toMatchObject({ id: 'mode', currentValue: 'plan' });
  });

  it('reports a failed switch instead of leaving the control lying', async () => {
    vi.mocked(acpSetMode).mockRejectedValueOnce(new Error('mode not found'));
    await useHarnessStore.getState().setMode(TAB, 'nope');

    expect(current().error).toContain('mode not found');
    expect(current().modes?.currentModeId).toBe('default');
  });

  it('resumes the remembered session and folds the replayed conversation', async () => {
    useHarnessSessionRefs.setState({
      refs: { 'Claude Code': { sessionId: 'older', cwd: '/tmp/project', at: 1 } },
    });
    const update = (text: string, sessionUpdate: string) => ({
      sessionId: 'older',
      kind: 'update' as const,
      payload: { params: { sessionId: 'older', update: { sessionUpdate, content: { type: 'text', text } } } },
    });
    vi.mocked(acpOpen).mockResolvedValueOnce({
      sessionId: 'older',
      harness: 'Claude Code',
      cwd: '/tmp/project',
      agent: { protocolVersion: 1, agentInfo: { name: 'Fake' }, agentCapabilities: null, authMethods: [] },
      modes: null,
      models: null,
      configOptions: null,
      replayed: [
        update('earlier question', 'user_message_chunk'),
        update('earlier answer', 'agent_message_chunk'),
      ],
    });
    useHarnessStore.setState({ byTab: {} });
    await useHarnessStore.getState().open(TAB, 'Claude Code', '/tmp/project');

    expect(acpOpen).toHaveBeenCalledWith('Claude Code', '/tmp/project', 'older');
    const transcript = JSON.stringify(current().messages);
    expect(transcript).toContain('earlier question');
    expect(transcript).toContain('earlier answer');
    expect(current().note).toBe('已恢复上次的对话。');
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('older');
  });

  it('opens a fresh connection without closing the previous conversation', async () => {
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('s1');
    const previous = current();
    const closed = vi.mocked(acpClose).mock.calls.length;
    vi.mocked(acpOpen).mockResolvedValueOnce({ sessionId: 'fresh-live', resumeSessionId: 'fresh-history',
      harness: 'Claude Code', cwd: '/tmp/project',
      agent: { protocolVersion: 1, agentInfo: null, agentCapabilities: null, authMethods: [] },
      modes: null, models: null, configOptions: null });
    await useHarnessStore.getState().open('second-connection', 'Claude Code', '/tmp/project', true);

    expect(acpOpen).toHaveBeenLastCalledWith('Claude Code', '/tmp/project', undefined);
    expect(acpClose).toHaveBeenCalledTimes(closed);
    expect(current()).toBe(previous);
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('fresh-history');
  });

  it('keeps the slash commands the agent advertises', () => {
    useHarnessStore.getState().applyEvent(notification({
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'web', description: 'Search the web', input: { hint: 'query' } },
        { name: 'test', description: 'Run tests' },
      ],
    }) as never);

    expect(current().commands).toEqual([
      { name: 'web', description: 'Search the web', hint: 'query' },
      { name: 'test', description: 'Run tests', hint: undefined },
    ]);
  });

  it('never starts a second agent while an open is still running', async () => {
    vi.mocked(acpOpen).mockClear();
    let release: (() => void) | undefined;
    vi.mocked(acpOpen).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({
        sessionId: 's1',
        harness: 'Claude Code',
        cwd: '/tmp/project',
        agent: { protocolVersion: 1, agentInfo: { name: 'Fake' }, agentCapabilities: null, authMethods: [] },
        modes: null,
        models: null,
        configOptions: null,
        replayed: [],
      });
    }));
    useHarnessStore.setState({ byTab: {} });

    const first = useHarnessStore.getState().open(TAB, 'Claude Code', '/tmp/project');
    const second = useHarnessStore.getState().open(TAB, 'Claude Code', '/tmp/project');
    await vi.waitFor(() => expect(acpOpen).toHaveBeenCalledTimes(1));
    release!();
    await Promise.all([first, second]);

    expect(acpOpen).toHaveBeenCalledTimes(1);
  });

  it('closes a late open without resurrecting its page or replacing the history reference', async () => {
    let finish: ((result: HarnessOpenResult) => void) | undefined;
    vi.mocked(acpOpen).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    useHarnessStore.setState({ byTab: {} });
    const reference = useHarnessSessionRefs.getState().refs['Claude Code'];
    const opening = useHarnessStore.getState().open(TAB, 'Claude Code', '/tmp/project', true);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await useHarnessStore.getState().close(TAB);
    finish!({ sessionId: 'late-live', resumeSessionId: 'late-history', harness: 'Claude Code', cwd: '/tmp/project',
      agent: { protocolVersion: 1, agentInfo: null, agentCapabilities: null, authMethods: [] },
      modes: null, models: null, configOptions: null });
    await opening;
    expect(useHarnessStore.getState().byTab[TAB]).toBeUndefined();
    expect(acpClose).toHaveBeenCalledWith('late-live');
    expect(useHarnessSessionRefs.getState().refs['Claude Code']).toBe(reference);
  });

  it('stores the history id separately and retains notifications received before open returns', async () => {
    vi.mocked(acpOpen).mockImplementationOnce(async () => {
      useHarnessStore.getState().applyEvent(notification({
        sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'early', description: 'Ready' }],
      }) as never);
      return { sessionId: SESSION, resumeSessionId: 'history-id', harness: 'Claude Code', cwd: '/tmp/project',
        agent: { protocolVersion: 1, agentInfo: null, agentCapabilities: null, authMethods: [] },
        modes: null, models: null, configOptions: null };
    });
    await useHarnessStore.getState().close(TAB);
    await useHarnessStore.getState().open(TAB, 'Claude Code', '/tmp/project');
    expect(current().commands[0]?.name).toBe('early');
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('history-id');
  });
});
