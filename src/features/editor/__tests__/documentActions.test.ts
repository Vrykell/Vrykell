import { beforeEach, expect, it, vi } from 'vitest';
import { editorFileKey } from '@core/editor';
import { pickPath } from '@platform/api/fs';
import { readEditorFile, saveEditorFile } from '@platform/api/editor';
import { useSessionStore } from '@features/workspace';
import { useEditorDocuments } from '../stores/documents';
import { newEditorFile, saveDocument } from '../services/documentActions';
vi.mock('@platform/api/fs', () => ({ pickPath: vi.fn() }));
vi.mock('@platform/api/editor', () => ({ readEditorFile: vi.fn(), saveEditorFile: vi.fn() }));
vi.mock('@platform/diagnostics', () => ({ invoke: vi.fn(), diagnostic: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); useSessionStore.setState({ tabs: [], activeId: '' }); useEditorDocuments.setState({ documents: {} });
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
