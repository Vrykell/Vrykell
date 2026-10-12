import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSessionHistory } from '../hooks/useSessionHistory';

vi.mock('@platform/api/session', () => ({ listSessions: vi.fn().mockResolvedValue([]) }));
vi.mock('@platform/api/group', () => ({ groupsList: vi.fn().mockResolvedValue([]) }));
afterEach(() => { cleanup(); sessionStorage.clear(); });

it('migrates previous filters and remembers mode and sorting across remounts', async () => {
  sessionStorage.setItem('vrykell-session-history-filter', JSON.stringify({ query: 'saved', type: 'local', date: '7d' }));
  const first = renderHook(() => useSessionHistory());
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(first.result.current.filter).toEqual({ query: 'saved', type: 'local', date: '7d', mode: 'all', sort: 'closed-desc' });
  act(() => first.result.current.setFilter({ mode: 'classic', sort: 'title-asc' }));
  first.unmount();
  const second = renderHook(() => useSessionHistory());
  await waitFor(() => expect(second.result.current.loading).toBe(false));
  expect(second.result.current.filter.mode).toBe('classic');
  expect(second.result.current.filter.sort).toBe('title-asc');
  expect(second.result.current.filter.query).toBe('saved');
});

it('falls back safely from invalid mode and sorting values', async () => {
  sessionStorage.setItem('vrykell-session-history-filter', JSON.stringify({ mode: 'invalid', sort: 'invalid' }));
  const { result } = renderHook(() => useSessionHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.filter).toEqual({ query: '', type: 'all', date: 'all', mode: 'all', sort: 'closed-desc' });
});
