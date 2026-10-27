import { afterEach, expect, it, vi } from 'vitest';
import { editorFileKey } from '@core/editor';
import { useEditorPreferences } from '@config/editor';
import { openPreferredFile } from '../services/openPreferredFile';

const mocks = vi.hoisted(() => ({ openEditor: vi.fn(), present: vi.fn() }));
vi.mock('@features/workspace', () => ({ useSessionStore: { getState: () => ({ openEditorFile: mocks.openEditor }) } }));
vi.mock('@features/workspace/services/unifiedWorkspace', () => ({ presentWorkspaceResource: mocks.present }));

const original = useEditorPreferences.getState();
afterEach(() => {
  useEditorPreferences.setState(original, true);
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
