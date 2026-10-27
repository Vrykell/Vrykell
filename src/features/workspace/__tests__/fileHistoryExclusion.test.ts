import { expect, it, vi } from 'vitest';
import { sessionHistorySnapshot, type WorkspaceHistorySnapshot } from '../model/workspaceHistory';
import { createWorkspaceHistoryWriter, persistContainerHistory } from '../services/workspaceHistory';
import { saveWorkspaceHistory } from '@platform/api/historyPage';

vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(async () => undefined), diagnostic: vi.fn() }));
vi.mock('@platform/api/historyPage', () => ({ saveWorkspaceHistory: vi.fn(async () => undefined) }));

const mixed = (): WorkspaceHistorySnapshot => ({ version: 1, focused: 'file', workspaceScope: 'unified',
  layout: { type: 'split', direction: 'row', ratio: 0.5,
    first: { type: 'pane', id: 'file', resourceId: 'file:draft' }, second: { type: 'pane', id: 'chat', resourceId: 'chat:saved' } },
  members: [
    { id: 'file:draft', title: 'Unsaved', kind: 'document', reference: 'Untitled.txt', draftId: 'draft', paneCount: 1, local: true, ssh: false },
    { id: 'chat:saved', title: 'Conversation', kind: 'conversation', reference: 'saved', paneCount: 1, local: false, ssh: false },
  ] });

it('prunes files and repairs focus while keeping the complete live restore snapshot', () => {
  const original = mixed();
  const history = sessionHistorySnapshot(original)!;
  expect(history.layout).toEqual({ type: 'pane', id: 'chat', resourceId: 'chat:saved' });
  expect(history.focused).toBe('chat'); expect(history.members).toEqual([original.members[1]]);
  expect(original.members).toHaveLength(2); expect(original.layout.type).toBe('split');
  original.focused = 'chat';
  expect(sessionHistorySnapshot(original)?.focused).toBe('chat');
  expect(sessionHistorySnapshot(history)).toBe(history);
  expect(sessionHistorySnapshot(null)).toBeNull();
});

it('never writes file-only groups, including comparisons, at either writer boundary', async () => {
  vi.mocked(saveWorkspaceHistory).mockClear();
  const source = mixed();
  const fileOnly: WorkspaceHistorySnapshot = { ...source, layout: source.layout.type === 'split' ? source.layout.first : source.layout, members: [source.members[0]!] };
  const writer = createWorkspaceHistoryWriter(vi.fn());
  expect(sessionHistorySnapshot(fileOnly)).toBeNull();
  await writer(fileOnly);
  await persistContainerHistory({ id: 'file-tab', scope: 'code', layout: fileOnly.layout, focused: 'file', groupId: 'files' }, fileOnly);
  fileOnly.members[0] = { ...fileOnly.members[0]!, kind: 'comparison', scope: 'unstaged' };
  await writer(fileOnly);
  expect(saveWorkspaceHistory).not.toHaveBeenCalled();
  await writer(source);
  const request = vi.mocked(saveWorkspaceHistory).mock.calls[0]![0];
  expect(JSON.parse(request.payload).members).toEqual([source.members[1]]);
  expect(request.payload).not.toMatch(/draft|Untitled|document|comparison/);
});
