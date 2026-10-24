import { expect, it } from 'vitest';
import { localize, localize2 } from '@ui/editor/code/localize';

it('translates embedded controls with the application catalog', () => {
  expect(localize('label.find', 'Find')).toBe('查找');
  expect(localize2('label.replace', 'Replace')).toEqual({ value: '替换', original: 'Replace' });
});

it('preserves placeholders and unknown technical messages', () => {
  expect(localize('unknown', 'Entry {0}: {1}', 'file')).toBe('Entry file: {1}');
  expect(localize('constructor', 'constructor')).toBe('constructor');
});
