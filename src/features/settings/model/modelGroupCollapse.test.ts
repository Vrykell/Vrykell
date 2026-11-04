import { afterEach, expect, it } from 'vitest';
import { MODEL_GROUP_COLLAPSE_KEY, readCollapsedModelGroups, saveCollapsedModelGroups } from './modelGroupCollapse';

afterEach(() => localStorage.clear());

it('round-trips collapsed model groups', () => {
  saveCollapsedModelGroups(new Set(['OpenCode', 'custom:对话模型']));
  expect([...readCollapsedModelGroups()]).toEqual(['OpenCode', 'custom:对话模型']);
});

it('ignores malformed or non-string collapse entries', () => {
  localStorage.setItem(MODEL_GROUP_COLLAPSE_KEY, '{not json');
  expect(readCollapsedModelGroups().size).toBe(0);
  localStorage.setItem(MODEL_GROUP_COLLAPSE_KEY, JSON.stringify(['OpenCode', 3, null]));
  expect([...readCollapsedModelGroups()]).toEqual(['OpenCode']);
});
