import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SkillDetail, SkillMeta } from '@features/agent/services/skills';
import { useSkillsSettings } from '@features/settings/hooks/useSkillsSettings';

const skillMocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  getSkill: vi.fn(),
  removeSkill: vi.fn(),
  installSkillMd: vi.fn(),
  fetchRemoteSkills: vi.fn(),
  importSkillsFromPath: vi.fn(),
  setSkillState: vi.fn(),
}));

vi.mock('@features/agent/services/skills', () => skillMocks);
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

describe('useSkillsSettings', () => {
  const meta: SkillMeta = {
    name: 'project-helper',
    description: '项目辅助',
    dir: 'C:/skills/project-helper',
    files: ['SKILL.md'],
    hasScripts: false,
    allowedTools: '',
    source: '本地',
    trusted: false,
    enabled: true,
    modified: false,
  };
  const detail: SkillDetail = { ...meta, prompt: '帮助项目开发' };

  beforeEach(() => {
    skillMocks.listSkills.mockReset().mockResolvedValue([meta]);
    skillMocks.getSkill.mockReset().mockResolvedValue(detail);
    skillMocks.setSkillState.mockReset().mockResolvedValue(undefined);
    skillMocks.removeSkill.mockReset().mockResolvedValue(undefined);
  });

  it('loads the list, opens details, and refreshes after a state change', async () => {
    const { result } = renderHook(() => useSkillsSettings());

    await waitFor(() => expect(result.current.metas).toEqual([meta]));
    act(() => void result.current.openDetail(meta.name));
    await waitFor(() => expect(result.current.detail?.prompt).toBe(detail.prompt));

    act(() => void result.current.toggleTrust(meta));
    await waitFor(() => expect(skillMocks.setSkillState).toHaveBeenCalledWith(meta.name, true, undefined));
    expect(skillMocks.listSkills).toHaveBeenCalledTimes(2);
  });

  it('imports a remote list and resets the URL after successful installation', async () => {
    skillMocks.fetchRemoteSkills.mockResolvedValue([{ name: 'remote', description: '远程', prompt: '内容' }]);
    skillMocks.installSkillMd.mockResolvedValue(meta);
    const { result } = renderHook(() => useSkillsSettings());

    act(() => result.current.setImportUrl(' https://example.com/skills.json '));
    await act(async () => { await result.current.doImportUrl(); });

    expect(skillMocks.fetchRemoteSkills).toHaveBeenCalledWith('https://example.com/skills.json');
    expect(skillMocks.installSkillMd).toHaveBeenCalledWith('remote', '远程', '内容');
    expect(result.current.importUrl).toBe('');
    expect(result.current.importing).toBe(false);
  });
});
