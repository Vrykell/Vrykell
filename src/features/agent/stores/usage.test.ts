import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USAGE_SOURCE } from '@features/agent/model/usageStats';
import { MAX_USAGE_RECORDS, useUsageStore } from './usage';

beforeEach(() => {
  useUsageStore.setState({ records: [], acp: {} });
});

describe('recordTurn', () => {
  it('stores the provider counts of one turn', () => {
    useUsageStore.getState().recordTurn({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 900,
      reasoningTokens: 40,
      steps: 3,
      toolCalls: 2,
      at: 1000,
    });
    const [record] = useUsageStore.getState().records;
    expect(record).toMatchObject({
      at: 1000,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 900,
      reasoningTokens: 40,
      steps: 3,
      toolCalls: 2,
    });
    expect(record!.id).toBeTruthy();
  });

  it('keeps a turn where the provider reported nothing out of the list', () => {
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4' });
    expect(useUsageStore.getState().records).toEqual([]);
  });

  it('normalizes missing, negative and fractional counts', () => {
    useUsageStore.getState().recordTurn({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: -5,
      outputTokens: 12.4,
      cachedInputTokens: Number.NaN,
      steps: -1,
    });
    expect(useUsageStore.getState().records[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 12,
      cachedInputTokens: 0,
      steps: 0,
      toolCalls: 0,
    });
  });

  it('appends in order and drops the oldest record past the cap', () => {
    for (let i = 0; i < MAX_USAGE_RECORDS + 3; i += 1) {
      useUsageStore.getState().recordTurn({
        provider: 'openai-compatible', model: 'gpt-4o-mini', inputTokens: 10, at: i,
      });
    }
    const records = useUsageStore.getState().records;
    expect(records).toHaveLength(MAX_USAGE_RECORDS);
    expect(records[0]!.at).toBe(3);
    expect(records[records.length - 1]!.at).toBe(MAX_USAGE_RECORDS + 2);
  });
});

describe('clear', () => {
  it('empties the list', () => {
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 10 });
    expect(useUsageStore.getState().records).toHaveLength(1);
    useUsageStore.getState().clear();
    expect(useUsageStore.getState().records).toEqual([]);
  });
});

describe('persistence', () => {
  it('restores token records and protocol totals from saved storage', async () => {
    const usage = useUsageStore.getState();
    usage.recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 123, outputTokens: 45, cachedInputTokens: 12, steps: 2, toolCalls: 3 });
    usage.acpUsage('Saved agent', { used: 12000, size: 200000, cost: 0.0042, currency: 'USD' });
    usage.acpTurn('Saved agent');
    usage.acpToolCall('Saved agent');
    const expected = { records: useUsageStore.getState().records, acp: useUsageStore.getState().acp };
    const saved = localStorage.getItem('vrykell-usage');
    expect(saved).not.toBeNull();

    useUsageStore.setState({ records: [], acp: {} });
    localStorage.setItem('vrykell-usage', saved!);
    await useUsageStore.persist.rehydrate();

    expect(useUsageStore.getState()).toMatchObject(expected);
  });

  it('persists clearing both kinds of usage without resurrecting old reports', async () => {
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 10 });
    useUsageStore.getState().acpTurn('Saved agent');
    useUsageStore.getState().clear();
    await useUsageStore.persist.rehydrate();
    expect(useUsageStore.getState()).toMatchObject({ records: [], acp: {} });
    expect(JSON.parse(localStorage.getItem('vrykell-usage')!)).toMatchObject({ state: { records: [], acp: {} } });
  });
});

describe('source', () => {
  it('records this app unless the caller names a harness', () => {
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 10 });
    useUsageStore.getState().recordTurn({
      source: 'opencode', provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 10,
    });
    expect(useUsageStore.getState().records.map((record) => record.source))
      .toEqual([DEFAULT_USAGE_SOURCE, 'opencode']);
  });

  it('reads rows written before the source field existed as this app', async () => {
    // 旧版本写下的载荷没有 source：合并时补上本机来源，而不是把它们归到未知来源
    localStorage.setItem('vrykell-usage', JSON.stringify({
      version: 2,
      state: {
        records: [{
          id: 'old', at: 1, provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 10, outputTokens: 1,
          cachedInputTokens: 0, reasoningTokens: 0, steps: 1, toolCalls: 0,
        }],
      },
    }));
    await useUsageStore.persist.rehydrate();
    expect(useUsageStore.getState().records[0]!.source).toBe(DEFAULT_USAGE_SOURCE);
  });
});
