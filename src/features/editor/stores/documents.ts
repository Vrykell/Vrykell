import { create } from 'zustand';
import { editorFileKey, type EditorContent, type EditorFile, type EditorEncoding } from '@core/editor';
import { readEditorFile, saveEditorFile } from '@platform/api/editor';
import { t } from '@i18n';
export interface DocumentState extends EditorContent { file: EditorFile; value: string; loading: boolean; saving: boolean; error: string; request: number }
let nextRequest = 0;
export const isDocumentDirty = (document?: DocumentState) => !!document && document.kind === 'text' && document.value !== document.text;
export const useEditorDocuments = create<{
  documents: Record<string, DocumentState>;
  load: (file: EditorFile, reload?: boolean, encoding?: EditorEncoding) => Promise<void>;
  edit: (file: EditorFile, value: string) => void;
  setDraftEncoding: (file: EditorFile, encoding: EditorEncoding) => void;
  save: (file: EditorFile, encoding?: EditorEncoding) => Promise<boolean>;
  saveAs: (file: EditorFile, target: EditorFile, closing?: boolean) => Promise<boolean>;
  drop: (keys: Set<string>) => void;
}>((set, get) => ({
  documents: {},
  load: async (file, reload = false, encoding) => {
    const key = editorFileKey(file); const previous = get().documents[key];
    if (previous && !reload) return;
    const request = ++nextRequest;
    if (file.draftId) {
      set(state => ({ documents: { ...state.documents, [key]: { file, text: '', value: '', revision: 'new', kind: 'text', saving: false, loading: false, error: '', request } } }));
      return;
    }
    const initial: DocumentState = previous ?? { file, text: '', value: '', revision: '', kind: 'text', saving: false, loading: true, error: '', request };
    set(state => ({ documents: { ...state.documents, [key]: { ...initial, loading: true, error: '', request } } }));
    try {
      const content = await readEditorFile({ ...file, ...(encoding ? { encoding } : {}) });
      if (get().documents[key]?.request === request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, ...content, value: content.text, loading: false } } }));
    } catch (reason) { if (get().documents[key]?.request === request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, loading: false, error: String(reason) } } })); }
  },
  edit: (file, value) => { const key = editorFileKey(file); if (get().documents[key]?.readOnly) return; set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, value } } })); },
  setDraftEncoding: (file, encoding) => { const key = editorFileKey(file); if (file.draftId && get().documents[key]) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key], encoding } } })); },
  save: async (file, encoding) => {
    const key = editorFileKey(file); const document = get().documents[key];
    if (!document || file.draftId || document.readOnly || document.loading || document.saving || document.kind !== 'text' || !document.revision) return false;
    if (!isDocumentDirty(document) && (!encoding || encoding === document.encoding)) return true;
    set(state => ({ documents: { ...state.documents, [key]: { ...document, saving: true, error: '' } } }));
    try {
      const selectedEncoding = encoding ?? document.encoding ?? 'utf8';
      const revision = await saveEditorFile({ ...file, encoding: selectedEncoding }, document.value, document.revision);
      if (get().documents[key]?.request === document.request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, revision, encoding: selectedEncoding, text: document.value, saving: false } } }));
      return !isDocumentDirty(get().documents[key]);
    } catch (reason) { if (get().documents[key]?.request === document.request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, saving: false, error: String(reason), ...(String(reason).includes('EDITOR_PERMISSION_DENIED:') ? { readOnly: true, permissionDenied: true } : {}) } } })); return false; }
  },
  saveAs: async (file, target, closing = false) => {
    const key = editorFileKey(file); const document = get().documents[key];
    const targetKey = editorFileKey(target);
    if (!document || document.loading || document.saving || document.kind !== 'text' || target.draftId || target.connectionId) return false;
    if (targetKey !== key && get().documents[targetKey]) {
      set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, error: t('This file is already open. Save or close that document first.') } } }));
      return false;
    }
    set(state => ({ documents: { ...state.documents, [key]: { ...document, saving: true, error: '' } } }));
    try {
      let expected = 'new';
      try {
        const existing = await readEditorFile(target);
        if (existing.kind !== 'text' || existing.readOnly) throw new Error(t('The destination is not a writable text file.'));
        expected = existing.revision;
      } catch (reason) {
        if (String(reason).includes(t('The destination is not a writable text file.'))) throw reason;
      }
      const revision = await saveEditorFile({ ...target, encoding: document.encoding ?? file.encoding ?? 'utf8' }, document.value, expected);
      if (get().documents[key]?.request !== document.request) return false;
      set(state => ({ documents: { ...state.documents,
        [key]: { ...state.documents[key]!, text: document.value, saving: false },
        ...(!closing ? { [targetKey]: { ...state.documents[key]!, file: target, text: document.value, revision, saving: false, readOnly: false, permissionDenied: false } } : {}),
      } }));
      return !closing || !isDocumentDirty(get().documents[key]);
    } catch (reason) {
      if (get().documents[key]?.request === document.request) set(state => ({ documents: { ...state.documents, [key]: { ...state.documents[key]!, saving: false, error: String(reason) } } }));
      return false;
    }
  },
  drop: keys => set(state => ({ documents: Object.fromEntries(Object.entries(state.documents).filter(([key]) => keys.has(key))) })),
}));
