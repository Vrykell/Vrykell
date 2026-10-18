import { describe, expect, it } from 'vitest';
import { filterModels, groupModelsByVendor } from './modelGroups';
import type { ModelProfile } from '@features/agent';

const model = (id: string, name: string, modelId: string): ModelProfile => ({
  id, name, provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: modelId,
});

describe('model list grouping', () => {
  it('groups by vendor, keeping the first appearance order', () => {
    const models = [
      model('1', 'A', 'deepseek-chat'),
      model('2', 'B', 'gpt-4o'),
      model('3', 'C', 'deepseek-reasoner'),
    ];
    const groups = groupModelsByVendor(models);
    expect(groups.map(group => group.key)).toEqual(['deepseek', 'openai']);
    expect(groups[0]!.models.map(item => item.id)).toEqual(['1', '3']);
    expect(groups[0]!.label).toBe('DeepSeek');
  });

  it('filters by search text and capability', () => {
    const models = [
      model('1', 'Chat', 'gpt-4o'),
      model('2', 'Reasoner', 'deepseek-reasoner'),
    ];
    expect(filterModels(models, 'reason', 'all').map(item => item.id)).toEqual(['2']);
    expect(filterModels(models, 'CHAT', 'all').map(item => item.id)).toEqual(['1']);
    expect(filterModels(models, '', 'reasoning').map(item => item.id)).toEqual(['2']);
    expect(filterModels(models, '', 'all')).toHaveLength(2);
    expect(filterModels(models, 'nothing', 'all')).toHaveLength(0);
  });

  it('keeps a model without an identifier in its own group', () => {
    const models = [
      model('1', 'A', 'deepseek-chat'),
      model('2', 'New', ''),
    ];
    const groups = groupModelsByVendor(models);
    expect(groups.map(group => group.key)).toEqual(['deepseek', 'unassigned']);
    expect(groups[1]!.models.map(item => item.id)).toEqual(['2']);
  });
});
