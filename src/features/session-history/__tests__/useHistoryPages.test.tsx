import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { readHistoryPage, type HistoryPage } from '@platform/api/historyPage';
import { useHistoryPages } from '../hooks/useHistoryPages';
import { groupsList } from '@platform/api/group';

vi.mock('@platform/api/historyPage', () => ({ readHistoryPage: vi.fn() }));
vi.mock('@platform/api/group', () => ({ groupsList: vi.fn().mockResolvedValue([]) }));
const read = vi.mocked(readHistoryPage);
const row = (id: string) => ({ id, title: id, created_at: 10, updated_at: 20, environment: '{}' });
beforeEach(() => { read.mockReset(); vi.mocked(groupsList).mockClear(); });

it('requests a bounded first page and serializes scroll requests without duplicate records', async () => {
  read.mockResolvedValueOnce({ sessions: [], conversations: [row('first')], nextCursor: { value: '20', key: 'conversation:first' } });
  let resolve!: (page: HistoryPage) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result } = renderHook(() => useHistoryPages('all', 'activity-desc', ''));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(read).toHaveBeenCalledWith({ source: 'all', sort: 'activity-desc', layout: 'all', limit: 40, cursor: null });
  act(() => { void result.current.loadMore(); void result.current.loadMore(); });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { resolve({ sessions: [], conversations: [row('first'), row('second')], nextCursor: null }); });
  expect(result.current.conversations.map(entry => entry.id)).toEqual(['first', 'second']);
  expect(result.current.hasMore).toBe(false);
  expect(groupsList).toHaveBeenCalledTimes(1);
});

it('drops late pages after a filter changes and preserves the cursor when retrying a failed page', async () => {
  let old!: (page: HistoryPage) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  read.mockResolvedValueOnce({ sessions: [], conversations: [row('new')], nextCursor: { value: '10', key: 'conversation:new' } });
  const { result, rerender } = renderHook(({ source }: { source: 'all' | 'conversation' }) => useHistoryPages(source, 'activity-desc', source), { initialProps: { source: 'all' } });
  rerender({ source: 'conversation' });
  await waitFor(() => expect(result.current.conversations[0]?.id).toBe('new'));
  await act(async () => { old({ sessions: [], conversations: [row('stale')], nextCursor: null }); });
  expect(result.current.conversations.map(entry => entry.id)).toEqual(['new']);
  read.mockRejectedValueOnce(new Error('Offline'));
  await act(() => result.current.loadMore());
  expect(result.current.error).toContain('Offline');
  read.mockResolvedValueOnce({ sessions: [], conversations: [row('retry')], nextCursor: null });
  await act(() => result.current.loadMore());
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { value: '10', key: 'conversation:new' } }));
  expect(result.current.conversations.map(entry => entry.id)).toEqual(['new', 'retry']);
});
