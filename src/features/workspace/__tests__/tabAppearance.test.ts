import { expect, it } from 'vitest';
import { tabIconKey, tabIconColor } from '../model/tabAppearance';

it('keeps singleton colors when a page reopens with a new tab id', () => {
  const first = { id: 'one', kind: 'settings' as const };
  const reopened = { id: 'two', kind: 'settings' as const };
  expect(tabIconKey(first)).toBe(tabIconKey(reopened));
  expect(tabIconColor(reopened, { [tabIconKey(first)]: 'blue' })).toBe('var(--group-blue)');
});

it('inherits the group color only when the session has no explicit override', () => {
  const tab = { id: 'one', kind: 'session' as const, groupId: 'team' };
  expect(tabIconColor(tab, { 'group:team': 'violet' })).toBe('var(--group-violet)');
  expect(tabIconColor(tab, { 'group:team': 'violet', 'session:one': 'cyan' })).toBe('var(--group-cyan)');
  expect(tabIconColor({ id: 'one', kind: 'settings', groupId: 'team' }, { 'group:team': 'violet' })).toBeUndefined();
});

it('keeps independent colors for sessions while preserving automatic defaults', () => {
  const first = { id: 'one', kind: 'session' as const };
  const second = { id: 'two', kind: 'session' as const };
  const colors = { [tabIconKey(first)]: 'cyan' as const };
  expect(tabIconColor(first, colors)).toBe('var(--group-cyan)');
  expect(tabIconColor(second, colors)).toBeUndefined();
});
