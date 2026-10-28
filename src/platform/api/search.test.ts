/**
 * api/search — argument tests for the search/history API wrappers.
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  searchFiles, searchHistory, recordHistory,
  clearHistory, searchBlocks, searchSessions,
} from '@platform/api/search';

describe('api/search', () => {
  it('searchFiles: default arguments and explicit roots/root', async () => {
    invokeMock.mockResolvedValueOnce([]);
    await searchFiles('q');
    expect(invokeMock).toHaveBeenLastCalledWith('search_files', {
      query: 'q', maxResults: 50, searchContent: false, root: null, roots: null,
    });
    invokeMock.mockResolvedValueOnce([]);
    await searchFiles('q', 10, true, '/a', ['/b', '/c']);
    expect(invokeMock).toHaveBeenLastCalledWith('search_files', {
      query: 'q', maxResults: 10, searchContent: true, root: '/a', roots: ['/b', '/c'],
    });
  });

  it('searchHistory: default arguments and filters', async () => {
    invokeMock.mockResolvedValueOnce([]);
    await searchHistory('q');
    expect(invokeMock).toHaveBeenLastCalledWith('search_history', {
      query: 'q', maxResults: 30, filterExitCode: null, since: null, cwd: null,
    });
    invokeMock.mockResolvedValueOnce([]);
    await searchHistory('q', 5, 1, 1000, '/w');
    expect(invokeMock).toHaveBeenLastCalledWith('search_history', {
      query: 'q', maxResults: 5, filterExitCode: 1, since: 1000, cwd: '/w',
    });
  });

  it('recordHistory / clearHistory / searchBlocks / searchSessions', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await recordHistory('echo hi', '/w', 0, 123);
    expect(invokeMock).toHaveBeenLastCalledWith('record_history', { command: 'echo hi', cwd: '/w', exitCode: 0, timestamp: 123 });

    invokeMock.mockResolvedValueOnce(undefined);
    await clearHistory();
    expect(invokeMock).toHaveBeenLastCalledWith('clear_history');

    invokeMock.mockResolvedValueOnce([]);
    await searchBlocks('q');
    expect(invokeMock).toHaveBeenLastCalledWith('search_blocks', { query: 'q', maxResults: 20, filterSessionStatus: null });
    invokeMock.mockResolvedValueOnce([]);
    await searchBlocks('q', 3, 'historical');
    expect(invokeMock).toHaveBeenLastCalledWith('search_blocks', { query: 'q', maxResults: 3, filterSessionStatus: 'historical' });

    invokeMock.mockResolvedValueOnce([]);
    await searchSessions('q');
    expect(invokeMock).toHaveBeenLastCalledWith('search_sessions', { query: 'q', maxResults: 10 });
  });
});
