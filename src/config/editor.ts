import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type FileOpenMode = 'editor' | 'terminal';
interface EditorPreferences {
  localOpenMode: FileOpenMode; remoteOpenMode: FileOpenMode;
  wordWrap: boolean; vimMode: boolean; lineNumbers: boolean;
  update: (patch: Partial<Pick<EditorPreferences, 'localOpenMode' | 'remoteOpenMode' | 'wordWrap' | 'vimMode' | 'lineNumbers'>>) => void;
}
export const useEditorPreferences = create<EditorPreferences>()(persist(set => ({
  localOpenMode: 'editor', remoteOpenMode: 'editor', wordWrap: false, vimMode: false, lineNumbers: true, update: patch => set(patch),
}), { name: 'vrykell-editor-preferences', merge: (saved, current) => {
  const value = saved as Partial<EditorPreferences> | null;
  return { ...current,
    localOpenMode: value?.localOpenMode === 'terminal' ? 'terminal' : 'editor', remoteOpenMode: value?.remoteOpenMode === 'terminal' ? 'terminal' : 'editor',
    wordWrap: value?.wordWrap === true, vimMode: value?.vimMode === true, lineNumbers: value?.lineNumbers !== false };
} }));
