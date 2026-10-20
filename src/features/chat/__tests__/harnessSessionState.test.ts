/**
 * Harness session state — what the agent publishes beyond the transcript.
 *
 * An ACP agent reports its modes, models and config options with the session, and later pushes the
 * active mode, a whole new configuration, its plan and the context window in use. The page draws
 * those as controls and a plan card, so the store has to keep them next to the messages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHarnessStore } from '@features/chat/stores/harness';
import { acpSetConfigOption, acpSetMode, acpSetModel } from '@platform/api/acp';

vi.mock('@platform/api/acp', () => ({
  acpAnswerPermission: vi.fn(async () => undefined),
  acpCancel: vi.fn(async () => undefined),
  acpClose: vi.fn(async () => undefined),
  acpOpen: vi.fn(async () => ({
    sessionId: 's1',
    harness: 'Claude Code',
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
  useHarnessStore.setState({ byTab: {} });
  await useHarnessStore.getState().open(TAB, 'Claude Code', '');
});

describe('harness session state', () => {
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
});
