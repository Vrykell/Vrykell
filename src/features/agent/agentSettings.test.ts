/**
 * agentSettings - global/model override/migration tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentSettings, defaultOpenModeForShell, DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@features/agent/stores/agentSettings';

beforeEach(() => {
  useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS }, overrides: {} });
});

describe('agentSettings', () => {
  it('update sets global values; updateModel overrides; resolve merges', () => {
    useAgentSettings.getState().update({ maxSteps: 10 });
    useAgentSettings.getState().updateModel('m1', { maxSteps: 5, deepThink: true });
    const eff = useAgentSettings.getState().resolve('m1');
    expect(eff.maxSteps).toBe(5);
    expect(eff.deepThink).toBe(true);
    expect(eff.agentMode).toBe(true); // Without an override it falls back to the global value
    const g = useAgentSettings.getState().resolve();
    expect(g.maxSteps).toBe(10);
  });

  it('resetModel clears the override', () => {
    useAgentSettings.getState().updateModel('m1', { maxSteps: 5 });
    useAgentSettings.getState().resetModel('m1');
    expect(useAgentSettings.getState().resolve('m1').maxSteps).toBe(DEFAULT_AGENT_SETTINGS.maxSteps);
  });

  it('defaultOpenModeForShell: returns by shell and falls back to block for unknown shells', () => {
    useAgentSettings.getState().update({ openModeByShell: { zsh: 'classic', bash: 'block', powershell: 'block', pwsh: 'block', cmd: 'block' } });
    expect(defaultOpenModeForShell('zsh')).toBe('classic');
    expect(defaultOpenModeForShell('bash')).toBe('block');
    expect(defaultOpenModeForShell('weird-shell')).toBe('block');
  });

  it('updateModel with an empty id falls back to global', () => {
    useAgentSettings.getState().updateModel('', { maxSteps: 7 });
    expect(useAgentSettings.getState().global.maxSteps).toBe(7);
  });

  it('resetModel on a missing model is a safe no-op', () => {
    useAgentSettings.getState().resetModel('nope');
    expect(useAgentSettings.getState().overrides).toEqual({});
  });

  it('resolve without a modelId returns the pure global settings', () => {
    useAgentSettings.getState().updateModel('m1', { maxSteps: 5 });
    expect(useAgentSettings.getState().resolve().maxSteps).toBe(DEFAULT_AGENT_SETTINGS.maxSteps);
  });

  it('migrate: v1 flat structure is folded into global and maxSteps<50 is raised to 50', () => {
    const migrate = useAgentSettings.persist.getOptions().migrate!;
    const out = migrate({ agentMode: false, deepThink: true, maxSteps: 3 } as never, 1) as {
      global: AgentSettings; overrides: Record<string, unknown>;
    };
    expect(out.global.agentMode).toBe(false);
    expect(out.global.deepThink).toBe(true);
    expect(out.global.maxSteps).toBe(50);
    expect(out.overrides).toEqual({});
    // Fields absent from the flat data use their defaults
    expect(out.global.autoTitle).toBe(DEFAULT_AGENT_SETTINGS.autoTitle);
  });

  it('migrate: structured data fills in default fields and overrides', () => {
    const migrate = useAgentSettings.persist.getOptions().migrate!;
    const out = migrate({ global: { maxSteps: 60 } } as never, 8) as {
      global: AgentSettings; overrides: Record<string, unknown>;
    };
    expect(out.global.maxSteps).toBe(60);
    expect(out.global.agentMode).toBe(true);
    expect(out.overrides).toEqual({});
  });

  it('migrate: null/non-object data is returned as-is', () => {
    const migrate = useAgentSettings.persist.getOptions().migrate!;
    expect(migrate(null, 1)).toBeNull();
  });
});
