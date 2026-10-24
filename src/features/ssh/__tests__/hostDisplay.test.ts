import { afterEach, expect, it } from 'vitest';
import { useLanguagePreferences } from '@i18n';
import { hostLastConnected } from '../model/hostDisplay';

const preference = useLanguagePreferences.getState().preference;
afterEach(() => useLanguagePreferences.getState().setPreference(preference));
it('uses concise localized connection times and retains unavailable dates', () => {
  useLanguagePreferences.getState().setPreference('zh');
  const now = new Date(2026, 9, 23, 16, 30).getTime();
  expect(hostLastConnected(undefined, now)).toBe('—');
  expect(hostLastConnected(Number.NaN, now)).toBe('—');
  expect(hostLastConnected(now - 120_000, now)).toBe('2分钟前');
  expect(hostLastConnected(now - 7_200_000, now)).toBe('今天 14:30');
  expect(hostLastConnected(now - 86_400_000, now)).toBe('昨天 16:30');
  useLanguagePreferences.getState().setPreference('en');
  expect(hostLastConnected(now - 120_000, now)).toBe('2 minutes ago');
});
