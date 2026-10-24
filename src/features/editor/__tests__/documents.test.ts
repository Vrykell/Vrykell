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
  expect(saveEditorFile).toHaveBeenCalledWith({ ...file, encoding: 'utf8' }, 'saved', 'v1');
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

it('prevents editing and saving read-only files and refreshes permissions on reload', async () => {
  vi.mocked(readEditorFile).mockResolvedValueOnce({ kind: 'text', text: 'protected', revision: 'v1', readOnly: true, permissionDenied: true });
  const store = useEditorDocuments.getState();
  await store.load(file);
  store.edit(file, 'blocked edit');
  expect(useEditorDocuments.getState().documents[key].value).toBe('protected');
  expect(await store.save(file)).toBe(false);
  expect(saveEditorFile).not.toHaveBeenCalled();
  vi.mocked(readEditorFile).mockResolvedValueOnce({ kind: 'text', text: 'protected', revision: 'v1', readOnly: false, permissionDenied: false });
  await store.load(file, true);
  store.edit(file, 'allowed edit');
  expect(useEditorDocuments.getState().documents[key].value).toBe('allowed edit');
});

it('keeps unsaved text when permissions are lost after opening', async () => {
  const store = useEditorDocuments.getState(); await store.load(file); store.edit(file, 'kept draft');
  vi.mocked(saveEditorFile).mockRejectedValueOnce('EDITOR_PERMISSION_DENIED: Write denied');
  expect(await store.save(file)).toBe(false);
  expect(useEditorDocuments.getState().documents[key]).toMatchObject({ value: 'kept draft', readOnly: true, permissionDenied: true });
});

it('reopens with an explicit encoding and preserves it on subsequent saves', async () => {
  vi.mocked(readEditorFile).mockResolvedValueOnce({ kind: 'text', text: 'decoded', revision: 'bytes-version', encoding: 'gbk' });
  const store = useEditorDocuments.getState();
  await store.load(file, true, 'gbk');
  expect(readEditorFile).toHaveBeenCalledWith({ ...file, encoding: 'gbk' });
  store.edit(file, 'updated');
  vi.mocked(saveEditorFile).mockResolvedValueOnce('encoded-version');
  expect(await store.save(file)).toBe(true);
  expect(saveEditorFile).toHaveBeenCalledWith({ ...file, encoding: 'gbk' }, 'updated', 'bytes-version');
});

it('converts unchanged text explicitly and preserves the original buffer on encoding failure', async () => {
  const store = useEditorDocuments.getState();
  await store.load(file);
  vi.mocked(saveEditorFile).mockRejectedValueOnce(new Error('Encoding cannot represent all characters'));
  expect(await store.save(file, 'windows1252')).toBe(false);
  expect(useEditorDocuments.getState().documents[key]).toMatchObject({ value: 'base', text: 'base', revision: 'v1', error: 'Error: Encoding cannot represent all characters' });
});

it('creates separate untitled buffers without reading a filesystem path', async () => {
  const store = useEditorDocuments.getState();
  const first = { path: 'Untitled.txt', draftId: 'first' }; const second = { path: 'Untitled.txt', draftId: 'second' };
  await store.load(first); await store.load(second); store.edit(first, 'first note');
  expect(readEditorFile).not.toHaveBeenCalled();
  expect(store.save(first)).resolves.toBe(false);
  expect(useEditorDocuments.getState().documents[editorFileKey(second)].value).toBe('');
  expect(isDocumentDirty(useEditorDocuments.getState().documents[editorFileKey(first)])).toBe(true);
  await store.load(first, true);
  expect(useEditorDocuments.getState().documents[editorFileKey(first)].value).toBe('');
});

it('saves a draft to a new destination exclusively and adopts its revision', async () => {
  const store = useEditorDocuments.getState(); const draft = { path: 'Untitled.txt', draftId: 'draft' };
  await store.load(draft); store.edit(draft, 'a note');
  vi.mocked(readEditorFile).mockRejectedValueOnce(new Error('File not found'));
  vi.mocked(saveEditorFile).mockResolvedValueOnce('saved-note');
  expect(await store.saveAs(draft, file)).toBe(true);
  expect(saveEditorFile).toHaveBeenCalledWith({ ...file, encoding: 'utf8' }, 'a note', 'new');
  expect(useEditorDocuments.getState().documents[key]).toMatchObject({ file, text: 'a note', value: 'a note', revision: 'saved-note', readOnly: false });
});

it('checks an existing destination revision and never overwrites an open buffer', async () => {
  const store = useEditorDocuments.getState(); const draft = { path: 'Untitled.txt', draftId: 'draft' };
  await store.load(draft); store.edit(draft, 'a note'); vi.mocked(saveEditorFile).mockResolvedValueOnce('v2');
  expect(await store.saveAs(draft, file)).toBe(true);
  expect(saveEditorFile).toHaveBeenCalledWith({ ...file, encoding: 'utf8' }, 'a note', 'v1');
  store.edit(file, 'existing buffer');
  expect(await store.saveAs(draft, file)).toBe(false);
  expect(useEditorDocuments.getState().documents[key].value).toBe('existing buffer');
  expect(saveEditorFile).toHaveBeenCalledTimes(1);
});

it('preserves drafts when saving as fails or the chosen file is not writable text', async () => {
  const store = useEditorDocuments.getState(); const draft = { path: 'Untitled.txt', draftId: 'draft' };
  await store.load(draft); store.edit(draft, 'kept note');
  vi.mocked(readEditorFile).mockResolvedValueOnce({ kind: 'binary', text: '', revision: 'binary' });
  expect(await store.saveAs(draft, file)).toBe(false); expect(saveEditorFile).not.toHaveBeenCalled();
  vi.mocked(saveEditorFile).mockRejectedValueOnce('Disk full');
  expect(await store.saveAs(draft, file)).toBe(false);
  expect(useEditorDocuments.getState().documents[editorFileKey(draft)]).toMatchObject({ value: 'kept note', text: '', saving: false, error: 'Disk full' });
});

it('keeps newer edits in the saved-as buffer and refuses to close a changed draft', async () => {
  const store = useEditorDocuments.getState(); const draft = { path: 'Untitled.txt', draftId: 'draft' };
  await store.load(draft); store.edit(draft, 'snapshot');
  let finish!: (revision: string) => void;
  vi.mocked(saveEditorFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saving = store.saveAs(draft, file);
  await vi.waitFor(() => expect(saveEditorFile).toHaveBeenCalled());
  store.edit(draft, 'newer text'); finish('v2'); expect(await saving).toBe(true);
  expect(useEditorDocuments.getState().documents[key]).toMatchObject({ value: 'newer text', text: 'snapshot' });
  store.drop(new Set([editorFileKey(draft)]));
  vi.mocked(saveEditorFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const closing = store.saveAs(draft, file, true);
  await vi.waitFor(() => expect(saveEditorFile).toHaveBeenCalledTimes(2));
  store.edit(draft, 'latest'); finish('v3'); expect(await closing).toBe(false);
  expect(useEditorDocuments.getState().documents[key]).toBeUndefined();
  expect(useEditorDocuments.getState().documents[editorFileKey(draft)]).toMatchObject({ value: 'latest', text: 'newer text', saving: false });
});
