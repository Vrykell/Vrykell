import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { marketGithubInstall, marketGithubList, type MarketSkill } from '@features/agent/services/skills';
import { useSkillMarketplace } from '../hooks/useSkillMarketplace';
import { StrictMode } from 'react';

vi.mock('@features/agent/services/skills', () => ({ marketGithubList: vi.fn(), marketGithubInstall: vi.fn() }));
const skill: MarketSkill = { name: 'sample', description: 'Sample skill', dir: 'skills/sample' };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(marketGithubList).mockResolvedValue([skill]); });

it('coalesces repeated initialization without hiding a real loading failure', async () => {
  vi.mocked(marketGithubList).mockRejectedValueOnce(new Error('Disconnected'));
  const { result } = renderHook(() => useSkillMarketplace('strict/repo', vi.fn()), { wrapper: StrictMode });
  await waitFor(() => expect(result.current.error).toContain('Disconnected'));
  expect(marketGithubList).toHaveBeenCalledOnce();
  await act(async () => { await result.current.browse(); });
  expect(result.current.remote).toEqual([skill]);
});

it('loads the built-in repository immediately and installs only from the loaded source', async () => {
  const installed = vi.fn();
  const { result } = renderHook(() => useSkillMarketplace('owner/repo', installed));
  await waitFor(() => expect(result.current.remote).toEqual([skill]));
  expect(marketGithubList).toHaveBeenCalledWith('owner/repo');
  await act(async () => { await result.current.install(skill); });
  expect(marketGithubInstall).toHaveBeenCalledWith('owner/repo', 'skills/sample');
  expect(installed).toHaveBeenCalledOnce();
  act(() => result.current.changeRepo('other/repo'));
  await act(async () => { await result.current.install(skill); });
  expect(marketGithubInstall).toHaveBeenCalledOnce();
  expect(result.current.remote).toEqual([]);
});

it('discards a late response after a repository switch and permits retry after a failure', async () => {
  let finish: (skills: MarketSkill[]) => void = () => {};
  vi.mocked(marketGithubList).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useSkillMarketplace('old/repo', vi.fn()));
  act(() => result.current.changeRepo('new/repo'));
  vi.mocked(marketGithubList).mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => { await result.current.browse(); });
  expect(result.current.error).toContain('Unavailable');
  await act(async () => { finish([skill]); });
  expect(result.current.remote).toEqual([]);
  await act(async () => { await result.current.browse(); });
  expect(result.current.error).toBe(''); expect(result.current.remote).toEqual([skill]);
});
