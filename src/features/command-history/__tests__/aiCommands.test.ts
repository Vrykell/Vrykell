import { beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { getCommandContext } from '@platform/api/commandHistory';
import { composeHistoryCommand } from '../services/aiCommands';
import type { ExecutionContext } from '../services/execution';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@platform/api/commandHistory', () => ({ getCommandContext: vi.fn() }));
vi.mock('@features/agent/services/provider', () => ({ createChatModel: vi.fn(() => 'model') }));
vi.mock('@features/agent/stores/aiConfig', () => ({ isApiKeyConfigured: () => true, activeModelProfile: () => ({ model: 'model' }) }));
const context: ExecutionContext = { target: 'local', scope: 'scope', root: '/app', cwd: '/app', paneId: 'pane', spec: { id: 'pane', kind: 'local', shellType: 'bash' } };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getCommandContext).mockResolvedValue({ root: '/app', platform: 'linux', files: [{ path: 'package.json', text: '{"scripts":{"build":"vite build"}}' }] }); });
it('uses project configuration and continuation messages to return an editable multi-line draft', async () => {
  vi.mocked(generateText).mockResolvedValue({ text: '```json\n{"command":"npm install\\nnpm run build","cwd":"/app","explanation":"Build release"}\n```' } as Awaited<ReturnType<typeof generateText>>);
  const messages = [{ role: 'user' as const, content: 'Build release' }];
  const draft = await composeHistoryCommand(context, messages, ['npm run dev'], new AbortController().signal);
  expect(draft.command).toBe('npm install\nnpm run build');
  expect(generateText).toHaveBeenCalledWith(expect.objectContaining({ messages, system: expect.stringContaining('package.json') }));
});
it('cancels before calling the model when the target has changed', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(composeHistoryCommand(context, [], [], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(generateText).not.toHaveBeenCalled();
});
it('rejects malformed model output while leaving history untouched', async () => {
  vi.mocked(generateText).mockResolvedValue({ text: '{"explanation":"missing command"}' } as Awaited<ReturnType<typeof generateText>>);
  await expect(composeHistoryCommand(context, [], [], new AbortController().signal)).rejects.toThrow();
});
