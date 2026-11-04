import { expect, it } from 'vitest';
import type { AcpQuestionField } from '@platform/api/acp';
import { harnessQuestionGroups, questionLabel } from '../model/harnessQuestions';

const choice: AcpQuestionField = { key: 'target', title: 'Target', description: 'Choose a target', kind: 'string', required: false,
  options: [{ value: 'local', label: 'Local', description: '' }], default: null, minimum: null, maximum: null, minLength: 0, maxLength: 4000, minItems: 0, maxItems: 0 };
const other = { ...choice, key: 'target_other', title: 'Target (other)', description: 'Type your own answer', options: [] };

it('pairs explicit companion fields regardless of schema order', () => {
  expect(harnessQuestionGroups([other, choice])).toEqual([{ field: choice, other }]);
});
it('retains independent fields and ambiguous repeated titles', () => {
  const independent = { ...other, key: 'notes', title: 'Deployment notes' };
  expect(harnessQuestionGroups([choice, independent])).toEqual([{ field: choice, other: undefined }, { field: independent, other: undefined }]);
  const second = { ...choice, key: 'second' };
  const ambiguous = { ...other, key: 'other' };
  expect(harnessQuestionGroups([choice, second, ambiguous])).toHaveLength(3);
});
it('localizes generated labels while preserving authored text', () => {
  expect(questionLabel('Questions')).toBe('问题');
  expect(questionLabel('Target (other)')).toBe('Target (其他回答)');
  expect(questionLabel('Type your own answer')).toBe('输入你的回答');
  expect(questionLabel('Explain your deployment plan')).toBe('Explain your deployment plan');
  expect(questionLabel('constructor')).toBe('constructor');
});
