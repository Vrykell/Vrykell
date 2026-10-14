import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_USAGE_RECORDS, useUsageStore } from './usage';

beforeEach(() => {
  useUsageStore.setState({ records: [] });
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
