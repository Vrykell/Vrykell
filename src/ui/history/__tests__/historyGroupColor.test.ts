import { describe, expect, it } from 'vitest';
import { historyGroupColor, isHistoryGroupColor } from '@ui/history/historyGroupColor';

describe('historyGroupColor', () => {
  it('distinguishes connection types and retains semantic terminal colors', () => {
    expect(new Set(['type:local', 'type:ssh', 'type:discussion'].map(historyGroupColor)).size).toBe(3);
    expect(historyGroupColor('terminal:ssh')).toBe(historyGroupColor('type:ssh'));
    expect(historyGroupColor('terminal:discussion')).toBe(historyGroupColor('type:discussion'));
  });

  it('uses the same discussion color in directory and type grouping', () => {
    expect(historyGroupColor('cwd:discussion')).toBe(historyGroupColor('type:discussion'));
  });

  it('distinguishes consecutive date groups', () => {
    expect(historyGroupColor('day:2026-9-14')).not.toBe(historyGroupColor('day:2026-9-13'));
    expect(historyGroupColor('month:2026-9')).not.toBe(historyGroupColor('month:2026-8'));
  });

  it.each(['all', 'terminal:default', 'cwd:unknown', 'cwd:multiple'])('keeps %s neutral', id => {
    expect(historyGroupColor(id)).toBe('neutral');
  });

  it('validates stored color overrides', () => {
    expect(isHistoryGroupColor('cyan')).toBe(true);
    expect(isHistoryGroupColor('neutral')).toBe(true);
    expect(isHistoryGroupColor('chartreuse')).toBe(false);
    expect(isHistoryGroupColor(undefined)).toBe(false);
    expect(isHistoryGroupColor(3)).toBe(false);
  });
});
