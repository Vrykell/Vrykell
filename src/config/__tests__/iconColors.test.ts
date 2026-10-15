import { afterEach, expect, it } from 'vitest';
import { iconColorCss, iconColorKey, useIconColorStore } from '../iconColors';

afterEach(() => { useIconColorStore.setState({ colors: {} }); localStorage.removeItem('vrykell-icon-colors'); });

it('persists explicit colors and removes overrides for automatic color', () => {
  const key = iconColorKey('session', 'one');
  useIconColorStore.getState().setColor(key, 'blue');
  expect(iconColorCss(useIconColorStore.getState().colors[key])).toBe('var(--group-blue)');
  expect(JSON.parse(localStorage.getItem('vrykell-icon-colors')!).state.colors).toEqual({ 'session:one': 'blue' });
  useIconColorStore.getState().setColor(key, null);
  expect(useIconColorStore.getState().colors[key]).toBeUndefined();
  expect(iconColorCss(undefined)).toBeUndefined();
});

it('ignores invalid persisted colors and preserves store actions during hydration', async () => {
  localStorage.setItem('vrykell-icon-colors', JSON.stringify({ state: { colors: {
    'session:one': 'cyan', 'page:settings': 'violet', 'group:team': 'green', 'session:bad': 'url(unsafe)', invalid: 'blue',
  } }, version: 0 }));
  await useIconColorStore.persist.rehydrate();
  expect(useIconColorStore.getState().colors).toEqual({ 'session:one': 'cyan', 'page:settings': 'violet', 'group:team': 'green' });
  expect(useIconColorStore.getState().setColor).toBeTypeOf('function');
});
