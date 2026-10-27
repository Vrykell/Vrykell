import { beforeEach, expect, it, vi } from 'vitest';
import { editorFileKey } from '@core/editor';
import { pickPath } from '@platform/api/fs';
import { readEditorFile, saveEditorFile } from '@platform/api/editor';
import { useSessionStore } from '@features/workspace';
import { emptyWorkbench } from '@features/workspace/model/workbench';
import { useWorkbenchStore } from '@features/workspace/stores/workbench';
import { useEditorDocuments } from '../stores/documents';
import { newEditorFile, saveDocument } from '../services/documentActions';
vi.mock('@platform/api/fs', () => ({ pickPath: vi.fn() }));
vi.mock('@platform/api/editor', () => ({ readEditorFile: vi.fn(), saveEditorFile: vi.fn() }));
vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(), diagnostic: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); useSessionStore.setState({ tabs: [], activeId: '' }); useEditorDocuments.setState({ documents: {} });
  useWorkbenchStore.setState({ snapshot: emptyWorkbench(), ready: false, lastClosed: null });
  vi.mocked(readEditorFile).mockRejectedValue(new Error('File not found'));
  vi.mocked(saveEditorFile).mockResolvedValue('new-version');
});
it('keeps independent new files and cancellation never discards the draft', async () => {
  newEditorFile(); newEditorFile();
  const page = useSessionStore.getState().tabs[0]; if (page.kind !== 'editor') throw new Error('Expected editor');
  expect(page.files.map(file => file.path)).toEqual(['未命名 1.txt', '未命名 2.txt']);
  useEditorDocuments.getState().edit(page.selected, 'draft'); vi.mocked(pickPath).mockResolvedValueOnce([]);
  expect(await saveDocument(page.selected)).toBe(false);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selected: page.selected });
  expect(useEditorDocuments.getState().documents[editorFileKey(page.selected)].value).toBe('draft');
  expect(saveEditorFile).not.toHaveBeenCalled();
});
it('saves an untitled document at the chosen location and keeps a close guard target until approved', async () => {
  newEditorFile(); const page = useSessionStore.getState().tabs[0]; if (page.kind !== 'editor') throw new Error('Expected editor');
  useEditorDocuments.getState().edit(page.selected, 'note'); vi.mocked(pickPath).mockResolvedValueOnce(['/notes/note.txt']);
  expect(await saveDocument(page.selected, false, true)).toBe(true);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selected: page.selected });
  vi.mocked(pickPath).mockResolvedValueOnce(['/notes/another.txt']);
  expect(await saveDocument(page.selected)).toBe(true);
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ selected: { path: '/notes/another.txt' } });
  expect(saveEditorFile).toHaveBeenCalledWith({ path: '/notes/another.txt', encoding: 'utf8' }, 'note', 'new');
});

it('keeps a saved draft in its existing split placement', async () => {
  newEditorFile();
  const page = useSessionStore.getState().tabs[0]; if (page.kind !== 'editor') throw new Error('Expected editor');
  const draft = page.selected; const other = { path: '/notes/other.txt' };
  useSessionStore.getState().openEditorFile(other);
  const draftId = `file:${editorFileKey(draft)}`; const otherId = `file:${editorFileKey(other)}`;
  useWorkbenchStore.setState({ ready: false, snapshot: { ...emptyWorkbench(), selected: { code: 'page' }, tabs: [{ id: 'page', scope: 'code', focused: 'left',
    layout: { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', id: 'left', resourceId: draftId }, second: { type: 'pane', id: 'right', resourceId: otherId } } }] } });
  useEditorDocuments.getState().edit(draft, 'note'); vi.mocked(pickPath).mockResolvedValueOnce(['/notes/note.txt']);
  expect(await saveDocument(draft)).toBe(true);
  const savedId = `file:${editorFileKey({ path: '/notes/note.txt' })}`;
  const container = useWorkbenchStore.getState().snapshot.tabs[0]!;
  expect(container).toMatchObject({ id: 'page', focused: 'left', layout: { type: 'split',
    first: { type: 'pane', id: 'left', resourceId: savedId }, second: { type: 'pane', id: 'right', resourceId: otherId } } });
  expect(useWorkbenchStore.getState().snapshot.selected.code).toBe('page');
  expect(useWorkbenchStore.getState().snapshot.tabs.some(tab => JSON.stringify(tab.layout).includes(draftId))).toBe(false);
});
