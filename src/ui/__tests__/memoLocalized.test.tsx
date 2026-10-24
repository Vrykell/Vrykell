import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider, t, useLanguagePreferences } from '@i18n';
import { memoLocalized } from '../memoLocalized';

afterEach(() => { cleanup(); useLanguagePreferences.setState({ preference: 'zh' }); });

it('skips layout-only renders while preserving live language changes and local drafts', () => {
  const renders = vi.fn();
  const Content = memoLocalized(function Content() {
    renders();
    const [draft, setDraft] = useState('');
    return <><span>{t('Settings')}</span><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} /></>;
  });
  function Layout() {
    const [width, setWidth] = useState(200);
    return <><button onClick={() => setWidth(value => value + 10)}>Resize</button><div style={{ width }}><Content /></div></>;
  }
  render(<I18nProvider><Layout /></I18nProvider>);
  const input = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(input, { target: { value: 'Unsent work' } });
  const before = renders.mock.calls.length;
  for (let index = 0; index < 10; index += 1) fireEvent.click(screen.getByText('Resize'));
  expect(renders).toHaveBeenCalledTimes(before);
  act(() => useLanguagePreferences.getState().setPreference('en'));
  expect(screen.getByText('Settings')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
  expect(input).toHaveValue('Unsent work');
});
