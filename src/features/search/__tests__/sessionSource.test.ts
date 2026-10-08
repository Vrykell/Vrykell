import { expect, it, vi } from 'vitest';
import { searchSessions } from '@platform/api/search';
import { getSource } from '../services/registry';
import '../services/sources/session';
import type { BackendSessionEntry } from '@platform/api/types';

vi.mock('@platform/api/search', () => ({ searchSessions: vi.fn() }));

it('omits meaningless classic counts in global session results while retaining block counts', async () => {
  const session = (mode: 'classic' | 'block'): BackendSessionEntry => ({
    id: mode, title: mode, kind: 'session', status: 'historical',
    created_at: 1, closed_at: 2, block_count: 3, cwd: '', group_id: null, sort_order: 0,
    payload: JSON.stringify({ layout: { type: 'leaf', terminal: { kind: 'local', openMode: mode } } }),
  });
  vi.mocked(searchSessions).mockResolvedValue([session('classic'), session('block')]);
  const results = await getSource('session')!.search('session');
  expect(results[0]?.subtitle).toBeUndefined();
  expect(results[1]?.subtitle).toBe('3 个命令块');
});
