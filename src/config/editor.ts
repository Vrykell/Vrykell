import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type FileOpenMode = 'editor' | 'terminal';
interface EditorPreferences {
  localOpenMode: FileOpenMode; remoteOpenMode: FileOpenMode;
  update: (patch: Partial<Pick<EditorPreferences, 'localOpenMode' | 'remoteOpenMode'>>) => void;
}
export const useEditorPreferences = create<EditorPreferences>()(persist(set => ({
  localOpenMode: 'editor', remoteOpenMode: 'editor', update: patch => set(patch),
}), { name: 'vrykell-editor-preferences', merge: (saved, current) => {
  const value = saved as Partial<EditorPreferences> | null;
  return { ...current,
    localOpenMode: value?.localOpenMode === 'terminal' ? 'terminal' : 'editor', remoteOpenMode: value?.remoteOpenMode === 'terminal' ? 'terminal' : 'editor' };
} }));
