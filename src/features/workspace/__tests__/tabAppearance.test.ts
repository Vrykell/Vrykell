import { expect, it } from 'vitest';
import { tabIconKey, tabIconColor } from '../model/tabAppearance';

it('keeps singleton colors when a page reopens with a new tab id', () => {
  const first = { id: 'one', kind: 'settings' as const };
  const reopened = { id: 'two', kind: 'settings' as const };
  expect(tabIconKey(first)).toBe(tabIconKey(reopened));
  expect(tabIconColor(reopened, { [tabIconKey(first)]: 'blue' })).toBe('var(--group-blue)');
});

it('keeps independent colors for sessions while preserving automatic defaults', () => {
  const first = { id: 'one', kind: 'session' as const };
  const second = { id: 'two', kind: 'session' as const };
  const colors = { [tabIconKey(first)]: 'cyan' as const };
  expect(tabIconColor(first, colors)).toBe('var(--group-cyan)');
  expect(tabIconColor(second, colors)).toBeUndefined();
});
