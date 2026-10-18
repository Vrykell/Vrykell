import { useEffect, useState, type ReactNode } from 'react';
import { editorFileKey, registerEditorCloseGuard, type EditorFile } from '@core/editor';
import { useEditorPreferences } from '@config/editor';
import { useSessionStore } from '@features/workspace';
import { fileIcon, openInTerminal } from '@features/files';
import CodeEditor from '@ui/CodeEditor';
import { IconButton } from '@ui/IconButton';
import ReloadButton from '@ui/ReloadButton';
import { TextButton } from '@ui/TextButton';
import { OutlineButton } from '@ui/OutlineButton';
import { Save, iconSizes } from '@ui/icons';
import FolderTabs, { type FolderTab } from '@ui/FolderTabs';
import EditorActions from '@ui/EditorActions';
import ToolDialog from '@ui/ToolDialog';
import ConfirmDialog from '@ui/ConfirmDialog';
import ErrorBox from '@ui/ErrorBox';
import { useToastStore } from '@ui/Toast';
import { t } from '@i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { interceptEditorClose } from '@core/editor';
import { isDocumentDirty, useEditorDocuments } from '../stores/documents';
import './editor.css';

export default function EditorWorkspace({ children }: { children: ReactNode }) {
  const tabs = useSessionStore(state => state.tabs); const activeId = useSessionStore(state => state.activeId);
  const mode = useEditorPreferences(state => state.pageMode);
  const documents = useEditorDocuments(state => state.documents);
  const page = tabs.find(tab => tab.id === activeId && tab.kind === 'editor');
  const files = tabs.filter(tab => tab.kind === 'editor').flatMap(tab => tab.files.map(file => ({ file, pageId: tab.id })));
  const keys = JSON.stringify(files.map(item => editorFileKey(item.file)));
  const [closing, setClosing] = useState<{ files: EditorFile[]; complete: () => void } | null>(null);
  const [saving, setSaving] = useState(false); const [closeError, setCloseError] = useState('');
  useEffect(() => { useSessionStore.getState().configureEditorTabs(mode); }, [mode]);
  useEffect(() => { useEditorDocuments.getState().drop(new Set(JSON.parse(keys) as string[])); }, [keys]);
  useEffect(() => registerEditorCloseGuard((requested, complete) => {
    if (!requested.some(file => isDocumentDirty(useEditorDocuments.getState().documents[editorFileKey(file)]))) return false;
    setCloseError(''); setClosing({ files: requested, complete }); return true;
  }), []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (Object.values(useEditorDocuments.getState().documents).some(isDocumentDirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => {
    let disposed = false; let stop: (() => void) | undefined; let approved = false;
    try {
      const appWindow = getCurrentWindow();
      void appWindow.onCloseRequested(event => {
        if (approved) { approved = false; return; }
        const open = useSessionStore.getState().tabs.flatMap(tab => tab.kind === 'editor' ? tab.files : []);
        if (interceptEditorClose(open, () => { approved = true; void appWindow.close(); })) event.preventDefault();
      }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    } catch { /* Browser previews do not own a native window. */ }
    return () => { disposed = true; stop?.(); };
  }, []);
  const saveClose = async () => {
    if (!closing || saving) return; setSaving(true); setCloseError('');
    const results = await Promise.all(closing.files.filter(file => isDocumentDirty(useEditorDocuments.getState().documents[editorFileKey(file)])).map(file => useEditorDocuments.getState().save(file)));
    setSaving(false);
    if (results.every(Boolean)) { closing.complete(); setClosing(null); }
    else setCloseError(t('Some files could not be saved. Your unsaved changes are kept.'));
  };
  const fileTabs: FolderTab[] = mode === 'single' ? files.map(({ file }) => {
    const Icon = fileIcon(file.path); const key = editorFileKey(file);
    return { id: key, label: `${file.path.split('/').pop()}${isDocumentDirty(documents[key]) ? ' •' : ''}`, tip: file.path, icon: <Icon size={iconSizes.compact} />, closeLabel: t('Close file {{path}}', { path: file.path }) };
  }) : [];
  return <>
    <div className="editor-content-host" style={{ display: page ? 'none' : 'flex' }} inert={!!page}>{children}</div>
    {files.map(({ file, pageId }) => <DocumentPane key={editorFileKey(file)} file={file} tabs={fileTabs} active={pageId === activeId && page?.kind === 'editor' && editorFileKey(page.selected) === editorFileKey(file)} />)}
    {closing && <ToolDialog label={t('Unsaved changes')} onClose={() => { if (!saving) setClosing(null); }} busy={saving} width={520}>
      <div className="editor-close-dialog"><p>{t('Save your changes before closing?')}</p><div className="editor-file-list">{closing.files.filter(file => isDocumentDirty(documents[editorFileKey(file)])).map(file => <span key={editorFileKey(file)}>{file.path}</span>)}</div>
        {closeError && <ErrorBox title={t('Could not save files')} details={closeError} />}
        <footer><OutlineButton disabled={saving} onClick={() => setClosing(null)}>{t('Cancel')}</OutlineButton>
          <OutlineButton disabled={saving} onClick={() => { closing.complete(); setClosing(null); }}>{t('Discard and close')}</OutlineButton>
          <OutlineButton className="primary-button" disabled={saving} onClick={() => { void saveClose(); }}>{t('Save and close')}</OutlineButton></footer></div>
    </ToolDialog>}
  </>;
}

function DocumentPane({ file, active, tabs }: { file: EditorFile; active: boolean; tabs: FolderTab[] }) {
  const document = useEditorDocuments(state => state.documents[editorFileKey(file)]);
  const [reload, setReload] = useState(false);
  useEffect(() => { void useEditorDocuments.getState().load(file); }, [file.path, file.connectionId]);
  const dirty = isDocumentDirty(document);
  const load = () => useEditorDocuments.getState().load(file, true);
  const save = () => { void useEditorDocuments.getState().save(file); };
  const reloadFile = () => { if (dirty) setReload(true); else void load(); };
  const terminal = () => { void openInTerminal(file).catch(reason => useToastStore.getState().addToast(String(reason), 'error')); };
  const Icon = fileIcon(file.path);
  return <section className="editor-pane" data-testid={active ? 'file-editor' : undefined} style={{ display: active ? 'flex' : 'none' }} inert={!active}>
    <FolderTabs items={active ? tabs : []} selected={editorFileKey(file)} label={t('Open files')} className="editor-tabs"
      onSelect={key => { const item = useSessionStore.getState().tabs.flatMap(tab => tab.kind === 'editor' ? tab.files : []).find(item => editorFileKey(item) === key); if (item) useSessionStore.getState().openEditorFile(item); }}
      onClose={key => { const item = useSessionStore.getState().tabs.flatMap(tab => tab.kind === 'editor' ? tab.files : []).find(item => editorFileKey(item) === key); if (item) useSessionStore.getState().closeEditorFile(item); }}
      onMove={(...args) => useSessionStore.getState().moveEditorFile(...args)} toolbar={<EditorActions items={[
        { label: t('Save file'), disabled: !dirty || document?.saving || document?.loading, onClick: save },
        { label: t('Reload file'), disabled: document?.saving, onClick: reloadFile }, { label: t('Open in terminal'), onClick: terminal },
      ]}>
        <IconButton compact aria-label={t('Save file')} data-tip={t('Save file (Ctrl/Cmd+S)')} disabled={!dirty || document?.saving || document?.loading} onClick={save}><Save size={iconSizes.control} /></IconButton>
        <span className="folder-action-secondary"><ReloadButton compact label={t('Reload file')} busy={document?.loading} disabled={document?.saving} onReload={reloadFile} /></span>
        <TextButton className="folder-action-secondary" onClick={terminal}>{t('Open in terminal')}</TextButton>
      </EditorActions>} />
    <div className="folder-path" data-tip={file.path}><Icon size={12} /><span>{file.path}{dirty ? ' •' : ''}</span></div>
    {document?.error && <ErrorBox title={t('Could not read or save file')} details={document.error} />}
    {(!document || document.loading) && <div className="code-diff-status" role="status">{t('Loading file…')}</div>}
    {document && !document.loading && document.kind !== 'text' && <div className="code-diff-status">{t(document.kind === 'binary' ? 'This file is binary or is not UTF-8. Open it with another editor.' : 'This file is too large for the embedded editor.')}</div>}
    {document && !document.loading && !!document.revision && document.kind === 'text' && <CodeEditor path={file.path} value={document.value} active={active} onChange={value => useEditorDocuments.getState().edit(file, value)} onSave={() => { void useEditorDocuments.getState().save(file); }} />}
    <ConfirmDialog open={reload} title={t('Reload file')} message={t('Reload this file and discard your unsaved changes?')} confirmLabel={t('Reload')} cancelLabel={t('Cancel')} onCancel={() => setReload(false)} onConfirm={() => { setReload(false); void load(); }} />
  </section>;
}
