import { describe, expect, it, vi } from 'vitest';
import { downloadsDiscard } from '@features/files/services/downloads';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock }));

describe('downloadsDiscard', () => {
  it('sends the local paths to the native discard command', async () => {
    invokeMock.mockResolvedValue(undefined);
    const paths = ['/home/u/.vrykell/downloads/a.txt'];

    await downloadsDiscard(paths);

    expect(invokeMock).toHaveBeenCalledWith('downloads_discard', { paths });
  });
});
