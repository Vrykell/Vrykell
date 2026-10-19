import { beforeEach, expect, it, vi } from 'vitest';
import { readEditorFile, saveEditorFile } from '@platform/api/editor';
import { useEditorDocuments, isDocumentDirty } from '../stores/documents';
import { editorFileKey } from '@core/editor';
vi.mock('@platform/api/editor', () => ({ readEditorFile: vi.fn(), saveEditorFile: vi.fn() }));
const file = { path: '/repo/file.ts' }; const key = editorFileKey(file);
beforeEach(() => { vi.resetAllMocks(); useEditorDocuments.setState({ documents: {} }); vi.mocked(readEditorFile).mockResolvedValue({ kind: 'text', text: 'base', revision: 'v1' }); });
it('reuses an open document without reloading or replacing its unsaved buffer', async () => {
  const store = useEditorDocuments.getState(); await store.load(file); store.edit(file, 'unsaved draft');
  const document = useEditorDocuments.getState().documents[key];
  await store.load({ ...file });
  expect(readEditorFile).toHaveBeenCalledTimes(1);
  expect(useEditorDocuments.getState().documents[key]).toBe(document);
  expect(useEditorDocuments.getState().documents[key]!.value).toBe('unsaved draft');
});
it('keeps newer edits typed while a save is pending and saves against the loaded revision', async () => {
  const store = useEditorDocuments.getState(); await store.load(file); store.edit(file, 'saved');
  let resolve!: (revision: string) => void;
  vi.mocked(saveEditorFile).mockImplementation(() => new Promise(done => { resolve = done; }));
  const saving = store.save(file); store.edit(file, 'newer'); resolve('v2');
  expect(await saving).toBe(false);
  expect(useEditorDocuments.getState().documents[key]).toMatchObject({ text: 'saved', value: 'newer', revision: 'v2' });
  expect(saveEditorFile).toHaveBeenCalledWith(file, 'saved', 'v1');
});
it('preserves an unsaved draft on a disk conflict and isolates saved connections', async () => {
  const store = useEditorDocuments.getState(); await store.load(file); store.edit(file, 'draft');
  vi.mocked(saveEditorFile).mockRejectedValue(new Error('Changed on disk')); expect(await store.save(file)).toBe(false);
  expect(isDocumentDirty(useEditorDocuments.getState().documents[key])).toBe(true);
  await store.load({ ...file, connectionId: 'remote' });
  expect(Object.keys(useEditorDocuments.getState().documents)).toHaveLength(2);
  expect(useEditorDocuments.getState().documents[key]!.value).toBe('draft');
});
it('ignores pending reads and saves from a file closed and opened again', async () => {
  const store = useEditorDocuments.getState();
  let resolveRead!: (value: Awaited<ReturnType<typeof readEditorFile>>) => void;
  vi.mocked(readEditorFile).mockImplementationOnce(() => new Promise(done => { resolveRead = done; }));
  const loading = store.load(file); store.drop(new Set()); await store.load(file);
  resolveRead({ kind: 'text', text: 'old read', revision: 'old' }); await loading;
  expect(useEditorDocuments.getState().documents[key]!.value).toBe('base');
  store.edit(file, 'old draft');
  let resolveSave!: (value: string) => void;
  vi.mocked(saveEditorFile).mockImplementationOnce(() => new Promise(done => { resolveSave = done; }));
  const saving = store.save(file); store.drop(new Set()); await store.load(file);
  resolveSave('old saved'); await saving;
  expect(useEditorDocuments.getState().documents[key]).toMatchObject({ value: 'base', text: 'base', revision: 'v1' });
});
