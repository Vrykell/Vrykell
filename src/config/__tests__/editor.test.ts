import { expect, it } from 'vitest';
import { useEditorPreferences } from '../editor';

it('ignores a saved multi-page mode and retains local and remote opening preferences', async () => {
  localStorage.setItem('vrykell-editor-preferences', JSON.stringify({ state: { pageMode: 'multiple', localOpenMode: 'terminal', remoteOpenMode: 'editor' }, version: 0 }));
  await useEditorPreferences.persist.rehydrate();
  expect(useEditorPreferences.getState()).not.toHaveProperty('pageMode');
  expect(useEditorPreferences.getState()).toMatchObject({ localOpenMode: 'terminal', remoteOpenMode: 'editor' });
  useEditorPreferences.getState().update({ localOpenMode: 'editor' });
  expect(JSON.parse(localStorage.getItem('vrykell-editor-preferences')!).state).not.toHaveProperty('pageMode');
});

it('persists optional text-editor behavior without enabling modal editing by default', async () => {
  localStorage.setItem('vrykell-editor-preferences', JSON.stringify({ state: { wordWrap: 'yes', vimMode: null }, version: 0 }));
  await useEditorPreferences.persist.rehydrate();
  expect(useEditorPreferences.getState()).toMatchObject({ wordWrap: false, vimMode: false, lineNumbers: true });
  useEditorPreferences.getState().update({ wordWrap: true, vimMode: true, lineNumbers: false });
  await useEditorPreferences.persist.rehydrate();
  expect(useEditorPreferences.getState()).toMatchObject({ wordWrap: true, vimMode: true, lineNumbers: false });
});
