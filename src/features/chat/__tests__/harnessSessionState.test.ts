/**
 * Harness session state — what the agent publishes beyond the transcript.
 *
 * An ACP agent reports its modes, models and config options with the session, and later pushes the
 * active mode, a whole new configuration, its plan and the context window in use. The page draws
 * those as controls and a plan card, so the store has to keep them next to the messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HARNESS_FIRST_RESPONSE_TIMEOUT_MS, useHarnessStore } from '@features/chat/stores/harness';
import { t } from '@i18n';
import { useHarnessSessionRefs } from '@features/chat/stores/harnessSessions';
import { acpCancel, acpClose, acpOpen, acpPrompt, acpAppToolResult, acpSetConfigOption, acpSetMode, acpSetModel, type HarnessOpenResult } from '@platform/api/acp';
import { answerUserQuestion, questionKey, useUserQuestions } from '@features/agent/services/userQuestions';

vi.mock('@platform/api/acp', () => ({
  acpAnswerPermission: vi.fn(async () => undefined),
  acpAppToolResult: vi.fn(async () => undefined),
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
afterEach(() => vi.useRealTimers());

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
  it('keeps empty sessions out of saved history until the first input', async () => {
    expect(useHarnessSessionRefs.getState().refs['Claude Code']).toBeUndefined();
    await useHarnessStore.getState().prompt(TAB, 'First input');
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe(SESSION);
  });

  it('sends queued inputs one at a time after stop events', async () => {
    vi.mocked(acpPrompt).mockClear();
    await useHarnessStore.getState().prompt(TAB, 'First');
    await useHarnessStore.getState().prompt(TAB, 'Second');
    await useHarnessStore.getState().prompt(TAB, 'Third');
    expect(acpPrompt).toHaveBeenCalledTimes(1);
    expect(current().queuedInputs?.map(item => item.text)).toEqual(['Second', 'Third']);
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'stop', payload: { stopReason: 'end_turn' } });
    await vi.waitFor(() => expect(acpPrompt).toHaveBeenCalledTimes(2));
    expect(acpPrompt).toHaveBeenLastCalledWith(SESSION, 'Second');
    expect(current().pending).toBe(true);
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'stop', payload: { stopReason: 'end_turn' } });
    await vi.waitFor(() => expect(acpPrompt).toHaveBeenCalledTimes(3));
    expect(acpPrompt).toHaveBeenLastCalledWith(SESSION, 'Third');
  });

  it('releases an unresponsive cancelled session and resumes without accepting late output', async () => {
    vi.useFakeTimers();
    await useHarnessStore.getState().prompt(TAB, 'First');
    await useHarnessStore.getState().prompt(TAB, 'Discard');
    const cancelled = useHarnessStore.getState().cancel(TAB);
    expect(current().pending).toBe(false);
    expect(current().queuedInputs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1201); await cancelled;
    expect(current().sessionId).toBeNull();
    expect(current().stopping).toBe(false);
    expect(acpClose).toHaveBeenCalledWith(SESSION);
    const before = current().messages;
    useHarnessStore.getState().applyEvent(notification({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Late output' } }) as never);
    expect(current().messages).toBe(before);
    await useHarnessStore.getState().prompt(TAB, 'Next');
    expect(acpOpen).toHaveBeenLastCalledWith('Claude Code', '/tmp/project', SESSION, expect.any(Array));
    expect(current().pending).toBe(true);
  });

  it('keeps a responsive session connected after acknowledged cancellation', async () => {
    await useHarnessStore.getState().prompt(TAB, 'First');
    const cancelled = useHarnessStore.getState().cancel(TAB);
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'stop', payload: { stopReason: 'cancelled' } });
    await cancelled;
    expect(current()).toMatchObject({ sessionId: SESSION, pending: false, stopping: false });
    const before = current().messages;
    useHarnessStore.getState().applyEvent(notification({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Late output' } }) as never);
    expect(current().messages).toBe(before);
  });

  it('cancels an in-flight connection and closes its late result without sending the old prompt', async () => {
    await useHarnessStore.getState().close(TAB);
    let finish!: (result: HarnessOpenResult) => void;
    vi.mocked(acpOpen).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const opening = useHarnessStore.getState().open(TAB, 'Claude Code', '/tmp/project', true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await useHarnessStore.getState().prompt(TAB, 'Queued during connection');
    await useHarnessStore.getState().cancel(TAB);
    expect(current()).toMatchObject({ pending: false, opening: false, queuedInputs: [] });
    finish({ sessionId: 'late-open', resumeSessionId: 'late-history', harness: 'Claude Code', cwd: '/tmp/project',
      agent: { protocolVersion: 1, agentInfo: null, agentCapabilities: null, authMethods: [] }, modes: null, models: null, configOptions: null });
    await opening;
    expect(acpClose).toHaveBeenCalledWith('late-open');
    expect(current().sessionId).toBeNull();
  });
  it('rotates the authorization identity when the execution target changes', () => {
    const original = current().toolContextId;
    useHarnessStore.setState({ byTab: { [TAB]: { ...current(), executionPaneId: 'previous-target' } } });
    useHarnessStore.getState().setExecutionPane(TAB, null);
    expect(current().toolContextId).not.toBe(original);
    expect(current().executionPaneId).toBeNull();
    const scope = current().toolContextId;
    useHarnessStore.setState({ byTab: { [TAB]: { ...current(), executionPaneId: 'previous-target', pending: true } } });
    useHarnessStore.getState().setExecutionPane(TAB, null);
    expect(current().executionPaneId).toBe('previous-target');
    expect(current().toolContextId).toBe(scope);
  });
  it('routes application questions into the owning transcript and returns the answer to that session', async () => {
    vi.mocked(acpAppToolResult).mockClear();
    await useHarnessStore.getState().prompt(TAB, 'Ask before changing files');
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'app-tool', payload: { method: 'call', requestId: 'question', name: 'ask_user', arguments: { question: 'Choose a folder', options: ['Project'] } } });
    const key = questionKey(current().toolContextId ?? TAB, 'app-mcp-question');
    await vi.waitFor(() => expect(useUserQuestions.getState().pending[key]).toBeTruthy());
    expect(current().messages.some(message => message.parts?.some(part => part.kind === 'tool' && part.tool.state === 'input-pending'))).toBe(true);
    answerUserQuestion(key, 'Project');
    await vi.waitFor(() => expect(acpAppToolResult).toHaveBeenCalledWith(SESSION, 'question', expect.objectContaining({ isError: false })));
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'stop', payload: { stopReason: 'end_turn' } });
  });

  it('rejects unbound terminal calls and cancels questions when the turn stops', async () => {
    vi.mocked(acpAppToolResult).mockClear();
    await useHarnessStore.getState().prompt(TAB, 'Do not choose a terminal implicitly');
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'app-tool', payload: { method: 'call', requestId: 'run', name: 'run_command', arguments: { command: 'echo test' } } });
    await vi.waitFor(() => expect(acpAppToolResult).toHaveBeenCalledWith(SESSION, 'run', expect.objectContaining({ isError: true })));
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'app-tool', payload: { method: 'call', requestId: 'cancel', name: 'ask_user', arguments: { question: 'Continue?' } } });
    const key = questionKey(current().toolContextId ?? TAB, 'app-mcp-cancel');
    await vi.waitFor(() => expect(useUserQuestions.getState().pending[key]).toBeTruthy());
    await useHarnessStore.getState().cancel(TAB);
    await vi.waitFor(() => expect(useUserQuestions.getState().pending[key]).toBeUndefined());
    useHarnessStore.getState().applyEvent({ sessionId: SESSION, kind: 'stop', payload: { stopReason: 'cancelled' } });
  });
  it('forgets only the requested saved reference without replacing a newer session', () => {
    useHarnessSessionRefs.getState().remember('Agent', { sessionId: 'newer', cwd: '/project', at: 20 });
    useHarnessSessionRefs.getState().forget('Agent', 'older');
    expect(useHarnessSessionRefs.getState().refs.Agent?.sessionId).toBe('newer');
    useHarnessSessionRefs.getState().forget('Agent', 'newer');
    expect(useHarnessSessionRefs.getState().refs.Agent).toBeUndefined();
    expect(useHarnessSessionRefs.getState().refs['Claude Code']).toBeUndefined();
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

    expect(acpOpen).toHaveBeenCalledWith('Claude Code', '/tmp/project', 'older', expect.arrayContaining([expect.objectContaining({ name: 'ask_user' })]));
    const transcript = JSON.stringify(current().messages);
    expect(transcript).toContain('earlier question');
    expect(transcript).toContain('earlier answer');
    expect(current().note).toBeNull();
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('older');
  });

  it('opens a fresh connection without closing the previous conversation', async () => {
    await useHarnessStore.getState().prompt(TAB, 'Existing conversation');
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('s1');
    const previous = current();
    const closed = vi.mocked(acpClose).mock.calls.length;
    vi.mocked(acpOpen).mockResolvedValueOnce({ sessionId: 'fresh-live', resumeSessionId: 'fresh-history',
      harness: 'Claude Code', cwd: '/tmp/project',
      agent: { protocolVersion: 1, agentInfo: null, agentCapabilities: null, authMethods: [] },
      modes: null, models: null, configOptions: null });
    await useHarnessStore.getState().open('second-connection', 'Claude Code', '/tmp/project', true);

    expect(acpOpen).toHaveBeenLastCalledWith('Claude Code', '/tmp/project', undefined, expect.arrayContaining([expect.objectContaining({ name: 'read_file' })]));
    expect(acpClose).toHaveBeenCalledTimes(closed);
    expect(current()).toBe(previous);
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('s1');
    await useHarnessStore.getState().prompt('second-connection', 'New conversation');
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
    expect(useHarnessSessionRefs.getState().refs['Claude Code']).toBeUndefined();
    await useHarnessStore.getState().prompt(TAB, 'First input');
    expect(useHarnessSessionRefs.getState().refs['Claude Code']?.sessionId).toBe('history-id');
  });

  it('surfaces a session notice as the status line', () => {
    useHarnessStore.getState().applyEvent(notification({
      sessionUpdate: 'notice', severity: 'warning', title: 'MCP server unavailable', description: 'Continuing without it.',
    }) as never);

    expect(current().note).toBe('MCP server unavailable · Continuing without it.');
  });

  it('keeps an authentication failure apart from every other failure', () => {
    useHarnessStore.getState().applyEvent({
      sessionId: SESSION, kind: 'error',
      payload: { message: 'agent error (-32603): API Error: 402 Insufficient Balance', details: 'exit code: 1', authRequired: false },
    });
    expect(current()).toMatchObject({ error: expect.stringContaining('402'), errorDetails: 'exit code: 1', authRequired: false });

    useHarnessStore.getState().applyEvent({
      sessionId: SESSION, kind: 'error',
      payload: { message: 'agent error (-32000): Authentication required', code: -32000, authRequired: true },
    });
    expect(current()).toMatchObject({ authRequired: true, errorDetails: null });
  });

  it('shows a transport end with the process diagnostics behind it', () => {
    vi.mocked(acpClose).mockClear();
    useHarnessStore.getState().applyEvent({
      sessionId: SESSION, kind: 'error',
      payload: { message: 'the agent closed the connection', reason: 'transport', details: 'exit code: 1\n\nboom' },
    });

    expect(current().error).toBe(t('The agent closed the connection.'));
    expect(current().errorDetails).toBe('exit code: 1\n\nboom');
    expect(current().pending).toBe(false);
    // A dead connection is not reused: the next prompt reopens it (or the retry action does).
    expect(current().sessionId).toBeNull();
    expect(acpClose).toHaveBeenCalledWith(SESSION);
  });

  it('stops a turn the agent never began', async () => {
    vi.useFakeTimers();
    await useHarnessStore.getState().prompt(TAB, 'Are you there?');
    vi.mocked(acpCancel).mockClear();

    await vi.advanceTimersByTimeAsync(HARNESS_FIRST_RESPONSE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1300);

    expect(acpCancel).toHaveBeenCalledWith(SESSION);
    expect(current().pending).toBe(false);
    expect(current().error).toBe(t('The agent did not respond in time; the turn was stopped.'));
  });

  it('does not stop a turn that is waiting for the user', async () => {
    vi.useFakeTimers();
    await useHarnessStore.getState().prompt(TAB, 'Ask me first');
    useHarnessStore.getState().applyEvent({
      sessionId: SESSION, kind: 'permission',
      payload: { toolCall: { toolCallId: 'call-1', title: 'Run it' }, options: [{ optionId: 'allow', name: 'Allow' }] },
    });
    vi.mocked(acpCancel).mockClear();

    await vi.advanceTimersByTimeAsync(HARNESS_FIRST_RESPONSE_TIMEOUT_MS);

    expect(acpCancel).not.toHaveBeenCalled();
    expect(current().pending).toBe(true);
    expect(current().permission?.title).toBe('Run it');
  });
});
