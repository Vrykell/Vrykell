/**
 * Harness config memory — the mode, model and config options a user picks survive into the next
 * new session of the same harness, while a resumed session keeps the state its agent returns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHarnessStore } from '@features/chat/stores/harness';
import { useHarnessSessionRefs } from '@features/chat/stores/harnessSessions';
import { useHarnessConfigPrefs } from '@features/chat/stores/harnessConfigPrefs';
import {
  acpOpen, acpSetConfigOption, acpSetMode, acpSetModel,
  type AcpConfigOption, type HarnessOpenResult,
} from '@platform/api/acp';

vi.mock('@features/terminal/services/terminalDebug', () => ({ terminalDebug: vi.fn() }));

vi.mock('@platform/api/acp', () => ({
  acpAnswerPermission: vi.fn(async () => undefined),
  acpAppToolResult: vi.fn(async () => undefined),
  acpCancel: vi.fn(async () => undefined),
  acpClose: vi.fn(async () => undefined),
  acpOpen: vi.fn(),
  acpPrompt: vi.fn(async () => undefined),
  acpSetConfigOption: vi.fn(),
  acpSetMode: vi.fn(async () => undefined),
  acpSetModel: vi.fn(async () => undefined),
  onAcpSession: vi.fn(async () => () => {}),
}));

const TAB = 'tab-config';
const SECOND = 'tab-config-second';
const THIRD = 'tab-config-third';
let openCount = 0;
let agentConfig: AcpConfigOption[] | null = null;

const selectable = (mode = 'standard', effort = 'medium'): AcpConfigOption[] => [
  { id: 'mode', name: 'Permissions', type: 'select', category: 'mode', currentValue: mode,
    options: [{ value: 'standard', name: 'Standard' }, { value: 'plan', name: 'Plan' }] },
  { id: 'reasoning_effort', name: 'Reasoning effort', type: 'select', currentValue: effort,
    options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
];

const openResult = (sessionId: string): HarnessOpenResult => ({
  sessionId,
  harness: 'Claude Code',
  cwd: '/tmp/project',
  agent: { protocolVersion: 1, agentInfo: null, agentCapabilities: null, authMethods: [] },
  modes: {
    currentModeId: 'default',
    availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }],
  },
  models: {
    currentModelId: 'm1',
    availableModels: [{ modelId: 'm1', name: 'Model One' }, { modelId: 'm2', name: 'Model Two' }],
  },
  configOptions: agentConfig,
  replayed: [],
});

const current = (tabId = TAB) => useHarnessStore.getState().byTab[tabId]!;
const open = (tabId = TAB) => useHarnessStore.getState().open(tabId, 'Claude Code', '/tmp/project', true);

beforeEach(() => {
  localStorage.clear();
  openCount = 0;
  agentConfig = null;
  vi.mocked(acpOpen).mockReset();
  vi.mocked(acpOpen).mockImplementation(async () => openResult(`s${++openCount}`));
  vi.mocked(acpSetMode).mockClear();
  vi.mocked(acpSetModel).mockClear();
  vi.mocked(acpSetConfigOption).mockReset();
  vi.mocked(acpSetConfigOption).mockImplementation(async (_sessionId, configId, value) => {
    agentConfig = (agentConfig ?? []).map(option => option.id === configId ? { ...option, currentValue: value } : option);
    return agentConfig;
  });
  useHarnessStore.setState({ byTab: {} });
  useHarnessSessionRefs.setState({ refs: {} });
  useHarnessConfigPrefs.setState({ prefs: {} });
});

describe('harness config memory', () => {
  it('remembers the mode and model a user picks and applies them to the next new session', async () => {
    await open();
    await useHarnessStore.getState().setMode(TAB, 'plan');
    await useHarnessStore.getState().setModel(TAB, 'm2');

    const stored = JSON.parse(localStorage.getItem('vrykell-harness-config')!);
    expect(stored.state.prefs['Claude Code']).toMatchObject({ mode: 'plan', model: 'm2' });

    vi.mocked(acpSetMode).mockClear();
    vi.mocked(acpSetModel).mockClear();
    await open(SECOND);

    expect(acpSetMode).toHaveBeenLastCalledWith('s2', 'plan');
    expect(acpSetModel).toHaveBeenLastCalledWith('s2', 'm2');
    expect(current(SECOND).modes?.currentModeId).toBe('plan');
    expect(current(SECOND).models?.currentModelId).toBe('m2');
  });

  it('restores config options the new session still offers and skips values it no longer does', async () => {
    agentConfig = selectable();
    await open();
    await useHarnessStore.getState().setConfigOption(TAB, 'mode', 'plan');
    await useHarnessStore.getState().setConfigOption(TAB, 'reasoning_effort', 'high');

    // A new session starts from the agent's own defaults; the remembered values are re-applied.
    agentConfig = selectable();
    vi.mocked(acpSetConfigOption).mockClear();
    await open(SECOND);

    expect(acpSetConfigOption).toHaveBeenCalledWith('s2', 'mode', 'plan');
    expect(acpSetConfigOption).toHaveBeenCalledWith('s2', 'reasoning_effort', 'high');
    expect(current(SECOND).configOptions?.map(option => [option.id, option.currentValue])).toEqual([
      ['mode', 'plan'],
      ['reasoning_effort', 'high'],
    ]);

    // The agent no longer offers the remembered mode or the extra option: its defaults win and no
    // request is sent.
    agentConfig = [{
      id: 'mode', name: 'Permissions', type: 'select', category: 'mode', currentValue: 'standard',
      options: [{ value: 'standard', name: 'Standard' }],
    }];
    vi.mocked(acpSetConfigOption).mockClear();
    await open(THIRD);

    expect(acpSetConfigOption).not.toHaveBeenCalled();
    expect(current(THIRD).configOptions?.[0]?.currentValue).toBe('standard');
  });

  it('never overrides a resumed session with the remembered defaults', async () => {
    await open();
    await useHarnessStore.getState().setMode(TAB, 'plan');
    await useHarnessStore.getState().setModel(TAB, 'm2');

    vi.mocked(acpSetMode).mockClear();
    vi.mocked(acpSetModel).mockClear();
    useHarnessStore.setState({ byTab: {} });
    await useHarnessStore.getState().open(SECOND, 'Claude Code', '/tmp/project', false, 'history');

    expect(acpSetMode).not.toHaveBeenCalled();
    expect(acpSetModel).not.toHaveBeenCalled();
    expect(current(SECOND).modes?.currentModeId).toBe('default');
    expect(current(SECOND).models?.currentModelId).toBe('m1');
  });

  it('keeps each harness configuration separate', async () => {
    await open();
    await useHarnessStore.getState().setMode(TAB, 'plan');

    await useHarnessStore.getState().open(SECOND, 'Other Agent', '/tmp/project', true);

    expect(acpSetMode).not.toHaveBeenCalledWith('s2', 'plan');
    expect(current(SECOND).modes?.currentModeId).toBe('default');
  });
});
