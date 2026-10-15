import { expect, it } from 'vitest';
import { tabIconKey, tabIconColor } from '../model/tabAppearance';
import { leaf } from '../model/windowLayout';

it('ignores legacy singleton colors and session keys assigned to a page', () => {
  const page = { id: 'one', kind: 'settings' as const };
  expect(tabIconColor(page, { 'page:settings': 'blue', 'session:one': 'violet' })).toBeUndefined();
});

it('inherits the saved SSH connection color while explicit terminal colors take priority', () => {
  const pane = { id: 'remote#0', kind: 'ssh' as const, ssh: { name: 'Remote', host: 'server.test', connectionId: 'saved' } };
  const tab = { id: 'remote', kind: 'session' as const, layout: leaf(pane) };
  expect(tabIconColor(tab, { 'ssh:saved': 'violet' })).toBe('var(--group-violet)');
  expect(tabIconColor(tab, { 'ssh:saved': 'violet', 'session:remote': 'blue' })).toBe('var(--group-blue)');
  expect(tabIconColor(tab, { 'ssh:other': 'violet' })).toBeUndefined();
  expect(tabIconColor(tab, { 'ssh:saved': 'violet' }, { id: 'local', kind: 'local' })).toBeUndefined();
  expect(tabIconColor(tab, { 'ssh:other': 'cyan' }, { ...pane, ssh: { ...pane.ssh, connectionId: 'other' } })).toBe('var(--group-cyan)');
});

it('uses only explicit session colors without inheriting retired group overrides', () => {
  const tab = { id: 'one', kind: 'session' as const, groupId: 'team' };
  expect(tabIconColor(tab, { 'group:team': 'violet' })).toBeUndefined();
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
