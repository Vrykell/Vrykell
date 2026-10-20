import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FileText } from '@ui/icons';
import { registerSource, useEnabledSourcesStore } from '../services/registry';
import { useSearchEngine } from '../hooks/useSearchEngine';
import type { SearchResult, SearchSource } from '../types';

it('publishes incremental file results, cancels old queries and ignores their late batches', async () => {
  const requests: { options: NonNullable<Parameters<SearchSource['search']>[1]>; finish: (results: SearchResult[]) => void }[] = [];
  const source: SearchSource = { id: 'file', label: 'Files', icon: FileText, search: vi.fn<SearchSource['search']>((_query, options) => new Promise<SearchResult[]>(resolve => {
    requests.push({ options: options!, finish: resolve });
  })) };
  registerSource(source);
  useEnabledSourcesStore.getState().setAll(new Set(['file']));
  const { result, unmount } = renderHook(useSearchEngine);
  act(() => result.current.search('early'));
  await waitFor(() => expect(requests).toHaveLength(1));
  const file: SearchResult = { id: '/early.log', title: 'early.log', type: 'file', data: { path: '/early.log', name: 'early.log', isDir: false, size: 0, modified: 0, matchType: 'name' } };
  act(() => requests[0].options.onProgress([file]));
  expect(result.current.state.allResults).toEqual([file]);
  expect(result.current.state.sources.file.loading).toBe(true);
  act(() => result.current.search('new'));
  expect(requests[0].options.signal.aborted).toBe(true);
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { requests[0].options.onProgress([file]); requests[0].finish([file]); });
  expect(result.current.state.allResults).toEqual([]);
  unmount();
  expect(requests[1].options.signal.aborted).toBe(true);
});
