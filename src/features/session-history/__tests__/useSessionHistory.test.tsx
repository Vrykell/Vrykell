import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSessionHistory } from '../hooks/useSessionHistory';

vi.mock('@platform/api/session', () => ({ listSessions: vi.fn().mockResolvedValue([]) }));
vi.mock('@platform/api/group', () => ({ groupsList: vi.fn().mockResolvedValue([]), groupRename: vi.fn() }));
afterEach(() => { cleanup(); sessionStorage.clear(); });

it('migrates previous filters and remembers mode, sorting and grouping across remounts', async () => {
  sessionStorage.setItem('vrykell-session-history-filter', JSON.stringify({ query: 'saved', type: 'local', date: '7d' }));
  const first = renderHook(() => useSessionHistory());
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(first.result.current.filter).toEqual({ query: 'saved', type: 'local', date: '7d', mode: 'all', sort: 'closed-desc', groupBy: 'day', dateField: 'closed', starredOnly: false });
  act(() => first.result.current.setFilter({ mode: 'classic', sort: 'title-asc', groupBy: 'cwd', starredOnly: true }));
  first.unmount();
  const second = renderHook(() => useSessionHistory());
  await waitFor(() => expect(second.result.current.loading).toBe(false));
  expect(second.result.current.filter.mode).toBe('classic');
  expect(second.result.current.filter.sort).toBe('title-asc');
  expect(second.result.current.filter.groupBy).toBe('cwd');
  expect(second.result.current.filter.query).toBe('saved');
  expect(second.result.current.filter.starredOnly).toBe(true);
});

it('falls back safely from invalid mode and sorting values', async () => {
  sessionStorage.setItem('vrykell-session-history-filter', JSON.stringify({ mode: 'invalid', sort: 'invalid', groupBy: 'invalid' }));
  const { result } = renderHook(() => useSessionHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.filter).toEqual({ query: '', type: 'all', date: 'all', mode: 'all', sort: 'closed-desc', groupBy: 'day', dateField: 'closed', starredOnly: false });
});

it.each(['mode', 'workspace'])('migrates the removed %s grouping while retaining search, filters and sorting', async groupBy => {
  sessionStorage.setItem('vrykell-session-history-filter', JSON.stringify({ query: 'remote', type: 'ssh', date: '30d', mode: 'classic', sort: 'created-asc', groupBy }));
  const { result } = renderHook(() => useSessionHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.filter).toEqual({ query: 'remote', type: 'ssh', date: '30d', mode: 'classic', sort: 'created-asc', groupBy: 'day', dateField: 'created', starredOnly: false });
  act(() => result.current.setFilter({ groupBy: 'terminal' }));
  expect(result.current.filter).toMatchObject({ query: 'remote', type: 'ssh', date: '30d', mode: 'classic', sort: 'created-asc', groupBy: 'terminal' });
});
