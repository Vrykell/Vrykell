import { afterEach, expect, it, vi } from 'vitest';
import { editorFileKey } from '@core/editor';
import { useEditorPreferences } from '@config/editor';
import { openPreferredFile } from '../services/openPreferredFile';
import { isSupportedEditorFile } from '../model/editorFileTypes';
import { useFileOpenFailure } from '../stores/fileOpenFailure';

const mocks = vi.hoisted(() => ({ openEditor: vi.fn(), present: vi.fn(), openPath: vi.fn(), download: vi.fn(), toast: vi.fn() }));
vi.mock('@features/workspace', () => ({ useSessionStore: { getState: () => ({ openEditorFile: mocks.openEditor }) } }));
vi.mock('@features/workspace/services/unifiedWorkspace', () => ({ presentWorkspaceResource: mocks.present }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: mocks.openPath }));
vi.mock('../model/fileOps', () => ({ fileOpsFor: () => ({ download: mocks.download }) }));
vi.mock('@ui/feedback/Toast', () => ({ useToastStore: { getState: () => ({ addToast: mocks.toast }) } }));

const original = useEditorPreferences.getState();
afterEach(() => {
  useEditorPreferences.setState(original, true);
  useFileOpenFailure.setState({ failure: null });
  vi.clearAllMocks();
});

it('presents the editor resource after opening with the preferred editor', () => {
  useEditorPreferences.setState({ localOpenMode: 'editor', remoteOpenMode: 'editor' });
  const file = { path: '/repo/file.ts' };
  openPreferredFile(file, vi.fn());
  expect(mocks.openEditor).toHaveBeenCalledWith(file);
  expect(mocks.present).toHaveBeenCalledWith(`file:${editorFileKey(file)}`);
});

it('leaves terminal fallbacks to present the terminal they create', async () => {
  useEditorPreferences.setState({ localOpenMode: 'terminal', remoteOpenMode: 'terminal' });
  const fallback = vi.fn();
  await openPreferredFile({ path: '/repo/file.ts' }, fallback);
  expect(fallback).toHaveBeenCalledOnce();
  expect(mocks.openEditor).not.toHaveBeenCalled();
  expect(mocks.present).not.toHaveBeenCalled();
});

it.each(['README', '.gitignore', '.env.local', 'Dockerfile', 'C:\\repo\\MAIN.TS', '/tmp/server.log', 'config.yaml'])('recognizes text and code files: %s', path => {
  expect(isSupportedEditorFile(path)).toBe(true);
});

it.each(['archive.zip', 'report.docx', 'photo.jpg', 'document.pdf', 'file.unknown', 'binary'])('routes unsupported types outside the editor: %s', path => {
  expect(isSupportedEditorFile(path)).toBe(false);
});

it('opens an unsupported local file through the system without opening a terminal or editor', async () => {
  useEditorPreferences.setState({ localOpenMode: 'editor' });
  mocks.openPath.mockResolvedValue(undefined);
  const fallback = vi.fn();
  await openPreferredFile({ path: '/repo/report.pdf' }, fallback);
  expect(mocks.openPath).toHaveBeenCalledWith('/repo/report.pdf');
  expect(mocks.openEditor).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it('downloads an unsupported remote file before opening it and explains that the copy is separate', async () => {
  useEditorPreferences.setState({ remoteOpenMode: 'editor' });
  mocks.download.mockResolvedValue('/tmp/report.pdf'); mocks.openPath.mockResolvedValue(undefined);
  await openPreferredFile({ path: '/remote/report.pdf', connectionId: 'host' }, vi.fn());
  expect(mocks.download).toHaveBeenCalledWith('/remote/report.pdf');
  expect(mocks.openPath).toHaveBeenCalledWith('/tmp/report.pdf');
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(mocks.openEditor).not.toHaveBeenCalled();
});

it('reports failed system opens without falling back to an editor', async () => {
  useEditorPreferences.setState({ localOpenMode: 'editor' });
  mocks.openPath.mockRejectedValue(new Error('unavailable'));
  await openPreferredFile({ path: '/repo/report.pdf' }, vi.fn());
  expect(useFileOpenFailure.getState().failure?.details).toContain('unavailable');
  expect(mocks.openEditor).not.toHaveBeenCalled();
});

it('retries a failed remote open without downloading the file twice', async () => {
  useEditorPreferences.setState({ remoteOpenMode: 'editor' });
  mocks.download.mockResolvedValue('/tmp/report.pdf');
  mocks.openPath.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(undefined);
  await openPreferredFile({ path: '/remote/report.pdf', connectionId: 'host' }, vi.fn());
  useFileOpenFailure.getState().failure?.retry();
  await vi.waitFor(() => expect(mocks.openPath).toHaveBeenCalledTimes(2));
  expect(mocks.download).toHaveBeenCalledOnce();
});
