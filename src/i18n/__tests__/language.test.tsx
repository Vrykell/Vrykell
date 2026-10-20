import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider, resolveLocale, t, useLanguagePreferences, useT } from '../index';
import zh from '../zh';
import en from '../en';

afterEach(() => { cleanup(); useLanguagePreferences.setState({ preference: 'zh' }); vi.restoreAllMocks(); });

it('changes visible text without remounting or losing a draft', () => {
  function Sample() { const { t } = useT(); return <><span>{t('Settings')}</span><input defaultValue="draft" /></>; }
  render(<I18nProvider><Sample /></I18nProvider>);
  const input = screen.getByRole('textbox');
  expect(screen.getByText('设置')).toBeVisible();
  act(() => useLanguagePreferences.getState().setPreference('en'));
  expect(screen.getByText('Settings')).toBeVisible();
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveValue('draft');
  expect(document.documentElement.lang).toBe('en');
  expect(JSON.parse(localStorage.getItem('vrykell-language')!).state.preference).toBe('en');
});

it('resolves system language and preserves interpolation and unknown labels', () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-TW');
  expect(resolveLocale('system')).toBe('zh');
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
  expect(resolveLocale('system')).toBe('en');
  useLanguagePreferences.setState({ preference: 'en' });
  expect(t('Close file {{path}}', { path: 'one.ts' })).toBe('Close file one.ts');
  expect(t('Unregistered label')).toBe('Unregistered label');
  useLanguagePreferences.setState({ preference: 'zh' });
  expect(t('Unregistered label')).toBe('Unregistered label');
});

it('provides English labels for every internal catalog key', () => {
  for (const key of Object.keys(zh).filter(key => /^[a-z][\w]*\.[\w.]+$/.test(key))) {
    expect(en[key], key).toBeTruthy();
  }
});
