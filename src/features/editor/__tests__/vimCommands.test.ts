import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { editorFileKey, type EditorFile, type EditorVimCommand } from '@core/editor';
import { useSessionStore } from '@features/workspace';
import { useWorkbenchStore } from '@features/workspace/stores/workbench';
import { useEditorDocuments } from '../stores/documents';
import { saveDocument } from '../services/documentActions';
import { executeEditorVimCommand } from '../services/vimCommands';

vi.mock('../services/documentActions', () => ({ saveDocument: vi.fn() }));
const workspace = useSessionStore.getState(); const documents = useEditorDocuments.getState();
const file: EditorFile = { path: '/note.txt' }; const other: EditorFile = { path: '/other.txt' };
const key = editorFileKey(file); const close = vi.fn(); const open = vi.fn(); const load = vi.fn().mockResolvedValue(undefined);
const command = (action: EditorVimCommand['action'], force = false): EditorVimCommand => ({ action, force, args: '', ranged: false });
beforeEach(() => {
  vi.clearAllMocks();
  useEditorDocuments.setState({ load, documents: { [key]: { file, kind: 'text', text: 'saved', value: 'draft', revision: 'r1', loading: false, saving: false, error: '', request: 1 } } });
  useSessionStore.setState({ tabs: [{ id: 'editor', kind: 'editor', title: 'Editor', files: [file, other], selected: file }], closeEditorFile: close, openEditorFile: open });
  useWorkbenchStore.getState().update(state => ({ ...state, tabs: [other, file].map((file, index) => ({ id: `container-${index}`, scope: 'code', focused: `pane-${index}`,
    layout: { type: 'pane', id: `pane-${index}`, resourceId: `file:${editorFileKey(file)}` } })) }));
});
afterEach(() => { useSessionStore.setState(workspace, true); useEditorDocuments.setState(documents, true); });

it('keeps normal quit behind the close guard and only discards when explicitly forced', async () => {
  await executeEditorVimCommand(file, command('quit')); expect(close).toHaveBeenLastCalledWith(file, false);
  await executeEditorVimCommand(file, command('delete', true)); expect(close).toHaveBeenLastCalledWith(file, true);
});
it('never closes on failed or cancelled writes and rejects unsupported file arguments', async () => {
  vi.mocked(saveDocument).mockResolvedValue(false);
  expect(await executeEditorVimCommand(file, command('writeQuit'))).toBe(false); expect(close).not.toHaveBeenCalled();
  expect(await executeEditorVimCommand(file, { ...command('write'), args: '/other.txt' })).toBe(false);
  expect(saveDocument).toHaveBeenCalledTimes(1);
});
it('writes before closing, but keeps a buffer modified during an asynchronous write', async () => {
  vi.mocked(saveDocument).mockImplementation(async () => {
    const document = useEditorDocuments.getState().documents[key];
    useEditorDocuments.setState({ documents: { [key]: { ...document, text: document.value } } }); return true;
  });
  expect(await executeEditorVimCommand(file, command('writeQuit'))).toBe(true); expect(close).toHaveBeenCalledWith(file, true);
  close.mockClear(); useEditorDocuments.getState().edit(file, 'new edit');
  vi.mocked(saveDocument).mockResolvedValue(true);
  expect(await executeEditorVimCommand(file, command('writeQuit'))).toBe(false); expect(close).not.toHaveBeenCalled();
});
it('protects dirty reloads and cycles according to the visible file order', async () => {
  expect(await executeEditorVimCommand(file, command('reload'))).toBe(false); expect(load).not.toHaveBeenCalled();
  await executeEditorVimCommand(file, command('reload', true)); expect(load).toHaveBeenCalledWith(file, true, undefined);
  await executeEditorVimCommand(file, command('next')); expect(open).toHaveBeenCalledWith(other);
  await executeEditorVimCommand(file, command('previous')); expect(open).toHaveBeenCalledWith(other);
});
it('exits unchanged documents without opening a save picker and blocks commands while loading', async () => {
  useEditorDocuments.getState().edit(file, 'saved');
  expect(await executeEditorVimCommand(file, command('exit'))).toBe(true); expect(saveDocument).not.toHaveBeenCalled();
  const document = useEditorDocuments.getState().documents[key]; useEditorDocuments.setState({ documents: { [key]: { ...document, loading: true } } });
  close.mockClear(); expect(await executeEditorVimCommand(file, command('quit', true))).toBe(false); expect(close).not.toHaveBeenCalled();
});
