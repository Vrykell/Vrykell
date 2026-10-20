import { create } from 'zustand';
import { editorFileKey, type EditorContent, type EditorFile } from '@core/editor';
import { readEditorFile, saveEditorFile } from '@platform/api/editor';
export interface DocumentState extends EditorContent { file: EditorFile; value: string; loading: boolean; saving: boolean; error: string; request: number }
let nextRequest = 0;
export const isDocumentDirty = (document?: DocumentState) => !!document && document.kind === 'text' && document.value !== document.text;
export const useEditorDocuments = create<{
  documents: Record<string, DocumentState>;
  load: (file: EditorFile, reload?: boolean) => Promise<void>;
  edit: (file: EditorFile, value: string) => void;
  save: (file: EditorFile) => Promise<boolean>;
  drop: (keys: Set<string>) => void;
}>((set, get) => ({
  documents: {},
  load: async (file, reload = false) => {
    const key = editorFileKey(file); const previous = get().documents[key];
    if (previous && !reload) return;
    const request = ++nextRequest;
    const initial: DocumentState = previous ?? { file, text: '', value: '', revision: '', kind: 'text', saving: false, loading: true, error: '', request };
    set(state => ({ documents: { ...state.documents, [key]: { ...initial, loading: true, error: '', request } } }));
    try {
      const content = await readEditorFile(file);
      if (get().documents[key]?.request === request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, ...content, value: content.text, loading: false } } }));
    } catch (reason) { if (get().documents[key]?.request === request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, loading: false, error: String(reason) } } })); }
  },
  edit: (file, value) => { const key = editorFileKey(file); if (get().documents[key]?.readOnly) return; set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, value } } })); },
  save: async file => {
    const key = editorFileKey(file); const document = get().documents[key];
    if (!document || document.readOnly || document.loading || document.saving || document.kind !== 'text' || !document.revision) return false;
    if (!isDocumentDirty(document)) return true;
    set(state => ({ documents: { ...state.documents, [key]: { ...document, saving: true, error: '' } } }));
    try {
      const revision = await saveEditorFile(file, document.value, document.revision);
      if (get().documents[key]?.request === document.request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, revision, text: document.value, saving: false } } }));
      return !isDocumentDirty(get().documents[key]);
    } catch (reason) { if (get().documents[key]?.request === document.request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, saving: false, error: String(reason), ...(String(reason).includes('EDITOR_PERMISSION_DENIED:') ? { readOnly: true, permissionDenied: true } : {}) } } })); return false; }
  },
  drop: keys => set(state => ({ documents: Object.fromEntries(Object.entries(state.documents).filter(([key]) => keys.has(key))) })),
}));
