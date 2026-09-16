import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSkillFileBrowser } from '@features/settings/hooks/useSkillFileBrowser';

const mocks = vi.hoisted(() => ({ readSkillFile: vi.fn() }));
vi.mock('@features/agent/services/skills', () => ({ readSkillFile: mocks.readSkillFile }));

describe('useSkillFileBrowser', () => {
  beforeEach(() => {
    mocks.readSkillFile.mockReset().mockResolvedValue('# 检查');
  });

  it('builds nested files, toggles directories, and reads selected files', async () => {
    const { result } = renderHook(() => useSkillFileBrowser({
      skillName: 'helper',
      files: ['SKILL.md', 'scripts/check.sh', 'docs/readme.md'],
    }));
    const scripts = result.current.tree.find((node) => node.name === 'scripts');
    const file = scripts?.children?.[0];
    expect(scripts?.isDir).toBe(true);
    expect(file?.path).toBe('scripts/check.sh');

    act(() => void result.current.pick(scripts!));
    expect(result.current.open.has('scripts')).toBe(true);

    await act(async () => { await result.current.pick(file!); });
    await waitFor(() => expect(result.current.content).toBe('# 检查'));
    expect(result.current.selected).toBe('scripts/check.sh');
    expect(mocks.readSkillFile).toHaveBeenCalledWith('helper', 'scripts/check.sh');
  });

  it('exposes a readable error when a skill file cannot be loaded', async () => {
    mocks.readSkillFile.mockRejectedValue(new Error('文件不存在'));
    const { result } = renderHook(() => useSkillFileBrowser({ skillName: 'helper', files: ['SKILL.md'] }));

    await act(async () => { await result.current.pick(result.current.tree[0]!); });
    expect(result.current.content).toBe('读取失败：文件不存在');
  });
});
