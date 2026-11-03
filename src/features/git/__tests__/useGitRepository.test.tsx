import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_REFRESH_DEBOUNCE_MS, useGitRepository } from '../hooks/useGitRepository';
import { getGitSnapshot } from '@platform/api/git';
import type { GitSnapshot } from '@core/git';

vi.mock('@platform/api/git', () => ({ getGitSnapshot: vi.fn(), getGitDiff: vi.fn(), changeGitFile: vi.fn() }));
const snapshot = (root: string): GitSnapshot => ({ root, branch: 'main', entries: [] });

beforeEach(() => vi.resetAllMocks());

describe('repository loading', () => {
  it('ignores a previous directory response after the target changes', async () => {
    let finish: (value: GitSnapshot) => void = () => {};
    vi.mocked(getGitSnapshot).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(snapshot('/second'));
    const { result, rerender } = renderHook(({ cwd }) => useGitRepository({ cwd }, true), { initialProps: { cwd: '/first' } });
    rerender({ cwd: '/second' });
    await waitFor(() => expect(result.current.snapshot?.root).toBe('/second'));
    await act(async () => finish(snapshot('/first')));
    expect(result.current.snapshot?.root).toBe('/second');
  });

  it('does not load a closed panel and exposes failures for retry', async () => {
    vi.mocked(getGitSnapshot).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    const { result, rerender } = renderHook(({ visible }) => useGitRepository({ cwd: '/repo' }, visible), { initialProps: { visible: false } });
    expect(getGitSnapshot).not.toHaveBeenCalled();
    rerender({ visible: true });
    await waitFor(() => expect(result.current.error).toBe('offline'));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe(''));
    expect(result.current.snapshot).toBeNull();
  });

  it('reuses a recent load instead of refreshing on every window focus', async () => {
    vi.mocked(getGitSnapshot).mockResolvedValue(snapshot('/repo'));
    renderHook(() => useGitRepository({ cwd: '/repo' }, true));
    await waitFor(() => expect(getGitSnapshot).toHaveBeenCalledTimes(1));
    const loadedAt = Date.now();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(loadedAt + 500);
    window.dispatchEvent(new Event('focus'));
    expect(getGitSnapshot).toHaveBeenCalledTimes(1);
    now.mockReturnValue(loadedAt + FOCUS_REFRESH_DEBOUNCE_MS + 1);
    window.dispatchEvent(new Event('focus'));
    now.mockRestore();
    await waitFor(() => expect(getGitSnapshot).toHaveBeenCalledTimes(2));
  });
});
