import { expect, it, vi } from 'vitest';
import { resolveCompletion } from '../services/completionArbiter';

it('stops at the first available provider in declared priority order', async () => {
  const builtin = vi.fn().mockResolvedValue(['history']);
  const shell = vi.fn().mockResolvedValue(['shell']);
  const path = vi.fn().mockResolvedValue(['path']);
  expect(await resolveCompletion([{ id: 'builtin', complete: builtin }, { id: 'shell', complete: shell }, { id: 'path', complete: path }], () => true))
    .toEqual({ provider: 'builtin', candidates: ['history'] });
  expect(shell).not.toHaveBeenCalled(); expect(path).not.toHaveBeenCalled();
});

it('falls back on empty or unavailable providers but not after cancellation', async () => {
  const path = vi.fn().mockResolvedValue(['path']);
  const shell = vi.fn().mockRejectedValue(new Error('Unavailable'));
  expect(await resolveCompletion([{ id: 'shell', complete: shell }, { id: 'path', complete: path }], () => true)).toEqual({ provider: 'path', candidates: ['path'] });
  path.mockClear(); let current = true;
  await resolveCompletion([{ id: 'shell', complete: async () => { current = false; return []; } }, { id: 'path', complete: path }], () => current);
  expect(path).not.toHaveBeenCalled();
});
