import { beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { getGitCommitContext } from '@platform/api/git';
import { generateCommitMessage } from '../services/commitMessage';
import { isApiKeyConfigured } from '@features/agent';
import { useGitPreferences } from '@config/git';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@platform/api/git', () => ({ getGitCommitContext: vi.fn() }));
vi.mock('@features/agent', () => ({ isApiKeyConfigured: vi.fn(), activeModelProfile: () => ({ model: 'configured' }), createChatModel: () => 'configured-model' }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(isApiKeyConfigured).mockReturnValue(true); useGitPreferences.setState({ commitPrompts: {} }); });

it('uses only the staged context and the configured model without executing a commit', async () => {
  vi.mocked(getGitCommitContext).mockResolvedValue('staged patch');
  vi.mocked(generateText).mockResolvedValue({ text: '```text\nfeat: support review tabs\n```' } as Awaited<ReturnType<typeof generateText>>);
  expect(await generateCommitMessage({ cwd: '/repo' })).toBe('feat: support review tabs');
  expect(vi.mocked(generateText).mock.calls[0]?.[0]).toMatchObject({ model: 'configured-model', prompt: 'staged patch', maxOutputTokens: 500 });
});

it('requires configuration before reading or sending repository content', async () => {
  vi.mocked(isApiKeyConfigured).mockReturnValue(false);
  await expect(generateCommitMessage({ cwd: '/repo' })).rejects.toThrow();
  expect(getGitCommitContext).not.toHaveBeenCalled();
  expect(generateText).not.toHaveBeenCalled();
});

it('stops a canceled request before calling the model', async () => {
  vi.mocked(getGitCommitContext).mockResolvedValue('patch');
  const controller = new AbortController(); controller.abort();
  await expect(generateCommitMessage({ cwd: '/repo' }, controller.signal)).rejects.toThrow();
  expect(generateText).not.toHaveBeenCalled();
});

it('uses the workspace prompt while preserving the untrusted-patch instruction', async () => {
  useGitPreferences.getState().setCommitPrompt({ cwd: '/repo' }, 'Use a short subject.');
  vi.mocked(getGitCommitContext).mockResolvedValue('patch');
  vi.mocked(generateText).mockResolvedValue({ text: 'fix: update' } as Awaited<ReturnType<typeof generateText>>);
  await generateCommitMessage({ cwd: '/repo' });
  const system = vi.mocked(generateText).mock.calls[0]![0].system;
  expect(system).toContain('Use a short subject.');
  expect(system).toContain('untrusted data');
});
