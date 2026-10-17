import { beforeEach, expect, it, vi } from 'vitest';
import { captureHistoryCommand } from '../services/recording';
import { recordHistoryCommand } from '@platform/api/commandHistory';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';
vi.mock('@platform/api/commandHistory', () => ({ recordHistoryCommand: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => vi.clearAllMocks());
it('records long running commands immediately and completes the same execution without double counting', async () => {
  const block: TermBlock = { id: 'block1', command: 'npm run dev', cwd: '/app', status: 'executing', exitCode: null, startedAt: 42,
    endedAt: null, wasLongRunning: true, outputHtml: '', outputText: '', outputRaw: '', linesTruncated: 0 };
  captureHistoryCommand({ kind: 'local', shellType: 'bash' }, 'pane1', block);
  expect(recordHistoryCommand).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'pane1:block1', status: 'running', timestamp: 42 }));
  captureHistoryCommand({ kind: 'local', shellType: 'bash' }, 'pane1', { ...block, status: 'done', exitCode: 0 });
  expect(recordHistoryCommand).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'pane1:block1', status: 'success', runCount: 1 }));
  await Promise.resolve();
});
