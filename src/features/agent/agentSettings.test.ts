/**
 * agentSettings — 全局/模型覆盖/迁移测试。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentSettings, defaultOpenModeForShell, DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@features/agent/agentSettings';

beforeEach(() => {
  useAgentSettings.setState({ global: { ...DEFAULT_AGENT_SETTINGS }, overrides: {} });
});

describe('agentSettings', () => {
  it('update 全局；updateModel 覆盖；resolve 合并', () => {
    useAgentSettings.getState().update({ maxSteps: 10 });
    useAgentSettings.getState().updateModel('m1', { maxSteps: 5, deepThink: true });
    const eff = useAgentSettings.getState().resolve('m1');
    expect(eff.maxSteps).toBe(5);
    expect(eff.deepThink).toBe(true);
    expect(eff.agentMode).toBe(true); // 未覆盖回落全局
    const g = useAgentSettings.getState().resolve();
    expect(g.maxSteps).toBe(10);
  });

  it('resetModel 清覆盖', () => {
    useAgentSettings.getState().updateModel('m1', { maxSteps: 5 });
    useAgentSettings.getState().resetModel('m1');
    expect(useAgentSettings.getState().resolve('m1').maxSteps).toBe(DEFAULT_AGENT_SETTINGS.maxSteps);
  });

  it('defaultOpenModeForShell：按 shell 返回，未知回退 block', () => {
    useAgentSettings.getState().update({ openModeByShell: { zsh: 'classic', bash: 'block', powershell: 'block', pwsh: 'block', cmd: 'block' } });
    expect(defaultOpenModeForShell('zsh')).toBe('classic');
    expect(defaultOpenModeForShell('bash')).toBe('block');
    expect(defaultOpenModeForShell('weird-shell')).toBe('block');
  });

  it('updateModel 空 id 回落全局', () => {
    useAgentSettings.getState().updateModel('', { maxSteps: 7 });
    expect(useAgentSettings.getState().global.maxSteps).toBe(7);
  });

  it('resetModel 不存在的模型安全 no-op', () => {
    useAgentSettings.getState().resetModel('nope');
    expect(useAgentSettings.getState().overrides).toEqual({});
  });

  it('resolve 不传 modelId = 纯全局', () => {
    useAgentSettings.getState().updateModel('m1', { maxSteps: 5 });
    expect(useAgentSettings.getState().resolve().maxSteps).toBe(DEFAULT_AGENT_SETTINGS.maxSteps);
  });

  it('migrate：v1 平铺结构收进 global，maxSteps<50 抬到 50', () => {
    const migrate = useAgentSettings.persist.getOptions().migrate!;
    const out = migrate({ agentMode: false, deepThink: true, maxSteps: 3 } as never, 1) as {
      global: AgentSettings; overrides: Record<string, unknown>;
    };
    expect(out.global.agentMode).toBe(false);
    expect(out.global.deepThink).toBe(true);
    expect(out.global.maxSteps).toBe(50);
    expect(out.overrides).toEqual({});
    // 未出现在平铺数据里的字段用默认值
    expect(out.global.autoTitle).toBe(DEFAULT_AGENT_SETTINGS.autoTitle);
  });

  it('migrate：结构化数据补齐缺省字段与 overrides', () => {
    const migrate = useAgentSettings.persist.getOptions().migrate!;
    const out = migrate({ global: { maxSteps: 60 } } as never, 8) as {
      global: AgentSettings; overrides: Record<string, unknown>;
    };
    expect(out.global.maxSteps).toBe(60);
    expect(out.global.agentMode).toBe(true);
    expect(out.overrides).toEqual({});
  });

  it('migrate：null/非对象数据原样返回', () => {
    const migrate = useAgentSettings.persist.getOptions().migrate!;
    expect(migrate(null, 1)).toBeNull();
  });
});
