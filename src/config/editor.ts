import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type EditorPageMode = 'single' | 'multiple';
export type FileOpenMode = 'editor' | 'terminal';
interface EditorPreferences {
  pageMode: EditorPageMode; localOpenMode: FileOpenMode; remoteOpenMode: FileOpenMode;
  update: (patch: Partial<Pick<EditorPreferences, 'pageMode' | 'localOpenMode' | 'remoteOpenMode'>>) => void;
}
export const useEditorPreferences = create<EditorPreferences>()(persist(set => ({
  pageMode: 'single', localOpenMode: 'editor', remoteOpenMode: 'editor', update: patch => set(patch),
}), { name: 'vrykell-editor-preferences', merge: (saved, current) => {
  const value = saved as Partial<EditorPreferences> | null;
  return { ...current, pageMode: value?.pageMode === 'multiple' ? 'multiple' : 'single',
    localOpenMode: value?.localOpenMode === 'terminal' ? 'terminal' : 'editor', remoteOpenMode: value?.remoteOpenMode === 'terminal' ? 'terminal' : 'editor' };
} }));
