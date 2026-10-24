import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EDITOR_ENCODINGS, editorFileKey, registerEditorCloseGuard, type EditorEncoding, type EditorFile } from '@core/editor';
import SafeMarkdown from '@features/chat/components/SafeMarkdown';
import ContextMenu, { type MenuAnchor } from '@ui/ContextMenu';
import { useSessionStore, useWorkspaceNavigation, WorkspaceResourceSwitcher, type Tab } from '@features/workspace';
import { openInTerminal } from '@features/files';
import CodeEditor, { type CodeEditorHandle, type EditorCommand } from '@ui/CodeEditor';
import { useEditorPreferences } from '@config/editor';
import { IconButton } from '@ui/IconButton';
import ReloadButton from '@ui/ReloadButton';
import { TextButton } from '@ui/TextButton';
import { OutlineButton } from '@ui/OutlineButton';
import { Eye, EyeOff, Save, Plus, FileCode, FolderOpen, Search, Undo2, RotateCw, iconSizes } from '@ui/icons';
import { isWindows } from '@platform/runtime';
import { normPath } from '@platform/path';
import FolderTabs, { type FolderTab } from '@ui/FolderTabs';
import WorkspaceHeader from '@ui/WorkspaceHeader';
import ResourceContent from '@ui/ResourceContent';
import { useCodeWorkspaceTabs } from '@features/workspace/hooks/useCodeWorkspaceTabs';
import { openWorkspaceFile } from '@features/workspace/services/workspaceActions';
import ToolDialog from '@ui/ToolDialog';
import ConfirmDialog from '@ui/ConfirmDialog';
import ErrorBox from '@ui/ErrorBox';
import { useToastStore } from '@ui/Toast';
import { t } from '@i18n';
import { useNativeCloseGuard } from '../hooks/useNativeCloseGuard';
import { isDocumentDirty, useEditorDocuments } from '../stores/documents';
import { newEditorFile, saveDocument } from '../services/documentActions';
import { executeEditorVimCommand } from '../services/vimCommands';
import ReadOnlyFileAccess from './ReadOnlyFileAccess';
import './editor.css';

export default function EditorWorkspace({ children }: { children: ReactNode }) {
  useNativeCloseGuard();
  const tabs = useSessionStore(state => state.tabs); const activeId = useSessionStore(state => state.activeId);
  const documents = useEditorDocuments(state => state.documents);
  const area = useWorkspaceNavigation(state => state.area);
  const page = area === 'code' ? tabs.find(tab => tab.id === activeId && tab.kind === 'editor') : undefined;
  const startTab = tabs.find(tab => tab.kind === 'start-code');
  const startActive = !!startTab && area === 'code' && activeId === startTab.id;
  const files = tabs.filter(tab => tab.kind === 'editor').flatMap(tab => tab.files.map(file => ({ file, pageId: tab.id })));
  // Keep editor hosts attached when only the navigation order changes.
  const panes = [...files].sort((a, b) => editorFileKey(a.file).localeCompare(editorFileKey(b.file)));
  const keys = JSON.stringify(panes.map(item => editorFileKey(item.file)));
  const [closing, setClosing] = useState<{ files: EditorFile[]; complete: () => void } | null>(null);
  const [saving, setSaving] = useState(false); const [closeError, setCloseError] = useState('');
  const pageCount = tabs.filter(tab => tab.kind === 'editor').length;
  useEffect(() => { useSessionStore.getState().configureEditorTabs(); }, [pageCount]);
  useEffect(() => { useEditorDocuments.getState().drop(new Set(JSON.parse(keys) as string[])); }, [keys]);
  useEffect(() => registerEditorCloseGuard((requested, complete) => {
    if (!requested.some(file => isDocumentDirty(useEditorDocuments.getState().documents[editorFileKey(file)]))) return false;
    setCloseError(''); setClosing({ files: requested, complete }); return true;
  }), []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (Object.values(useEditorDocuments.getState().documents).some(isDocumentDirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const saveClose = async () => {
    if (!closing || saving) return; setSaving(true); setCloseError('');
    const results: boolean[] = [];
    for (const file of closing.files.filter(item => isDocumentDirty(useEditorDocuments.getState().documents[editorFileKey(item)]))) results.push(await saveDocument(file, false, true));
    setSaving(false);
    if (results.every(Boolean)) { closing.complete(); setClosing(null); }
    else setCloseError(t('Some files could not be saved. Your unsaved changes are kept.'));
  };
  return <>
    <div className="editor-content-host" style={{ display: page || startActive ? 'none' : 'flex' }} inert={!!page || startActive}>{children}</div>
    {panes.map(({ file, pageId }) => <DocumentPane key={editorFileKey(file)} file={file} active={pageId === activeId && page?.kind === 'editor' && editorFileKey(page.selected) === editorFileKey(file)} />)}
    {startTab && <CodeStartPane tab={startTab} active={startActive} />}
    {closing && <ToolDialog label={t('Unsaved changes')} onClose={() => { if (!saving) setClosing(null); }} busy={saving} width={520}>
      <div className="editor-close-dialog"><p>{t('Save your changes before closing?')}</p><div className="editor-file-list">{closing.files.filter(file => isDocumentDirty(documents[editorFileKey(file)])).map(file => <span key={editorFileKey(file)}>{file.path}</span>)}</div>
        {closeError && <ErrorBox title={t('Could not save files')} details={closeError} />}
        <footer><OutlineButton disabled={saving} onClick={() => setClosing(null)}>{t('Cancel')}</OutlineButton>
          <OutlineButton disabled={saving} onClick={() => { closing.complete(); setClosing(null); }}>{t('Discard and close')}</OutlineButton>
          <OutlineButton className="primary-button" disabled={saving} onClick={() => { void saveClose(); }}>{t('Save and close')}</OutlineButton></footer></div>
    </ToolDialog>}
  </>;
}

function CodeStartPane({ tab, active }: { tab: Extract<Tab, { kind: 'start-code' }>; active: boolean }) {
  const items: FolderTab[] = [{
    id: tab.id, label: tab.title, tip: tab.title, icon: <FileCode size={iconSizes.control} />,
    closeLabel: t('Close this tab'), surface: 'canvas', renameable: false,
    dataAttributes: { 'data-tab-kind': 'start-code' },
  }];
  return <section className="editor-pane" data-testid="code-start-page" style={{ display: active ? 'flex' : 'none' }} inert={!active}>
    <WorkspaceHeader active={active}><FolderTabs items={items} selected={tab.id} label={t('Open files and comparisons')}
      listId="code-documents" className="editor-tabs" onSelect={() => useSessionStore.getState().activate(tab.id)}
      onClose={() => useSessionStore.getState().closeTab(tab.id)} onMove={() => {}}
      menuItems={[{ label: t('New file'), onClick: newEditorFile }, { label: t('Open file'), onClick: () => void openWorkspaceFile() }]}
      toolbar={<><WorkspaceResourceSwitcher /><IconButton compact aria-label={t('Open file')} data-tip={t('Open file')} onClick={() => void openWorkspaceFile()}><FolderOpen size={iconSizes.control} /></IconButton><IconButton compact aria-label={t('New file')} data-tip={t('New file')} onClick={newEditorFile}><Plus size={iconSizes.control} /></IconButton></>} /></WorkspaceHeader>
    <div className="workspace-empty workspace-start-page" data-testid="code-start-page-content">
      <FileCode size={40} />
      <h2>{t('Your text editor')}</h2>
      <p>{t('Write a note, edit a file, or review changes.')}</p>
      <div className="editor-start-actions"><OutlineButton className="primary-button" onClick={newEditorFile}>{t('New file')}</OutlineButton><OutlineButton onClick={() => void openWorkspaceFile()}>{t('Open file')}</OutlineButton></div>
    </div>
  </section>;
}

function DocumentPane({ file, active }: { file: EditorFile; active: boolean }) {
  return <ResourceContent id={`file:${editorFileKey(file)}`} active={active}>{state => <DocumentContent file={file} active={state.visible} focused={state.focused} />}</ResourceContent>;
}

function DocumentContent({ file, active, focused }: { file: EditorFile; active: boolean; focused: boolean }) {
  const codeTabs = useCodeWorkspaceTabs();
  const preferences = useEditorPreferences();
  const editor = useRef<CodeEditorHandle | null>(null);
  const document = useEditorDocuments(state => state.documents[editorFileKey(file)]);
  const [reload, setReload] = useState(false);
  const [preview, setPreview] = useState(false);
  const [encodingMenu, setEncodingMenu] = useState<MenuAnchor | null>(null);
  const [reopenEncoding, setReopenEncoding] = useState<EditorEncoding | null>(null);
  const markdown = /\.(md|markdown|mdown)$/i.test(file.path);
  useEffect(() => { void useEditorDocuments.getState().load(file); }, [file.path, file.connectionId]);
  const dirty = isDocumentDirty(document);
  const load = () => useEditorDocuments.getState().load(file, true);
  const save = () => { void saveDocument(file); };
  const saveAs = () => { void saveDocument(file, true); };
  const run = (command: EditorCommand) => editor.current?.run(command);
  const canEdit = !!document && document.kind === 'text' && !document.loading && !document.readOnly;
  const canSave = canEdit && !document.saving && (dirty || !!file.draftId);
  const reloadFile = () => { if (dirty) setReload(true); else void load(); };
  const terminal = () => { void openInTerminal(file).catch(reason => useToastStore.getState().addToast(String(reason), 'error')); };
  const elevatedLabel = t(!file.connectionId && isWindows ? 'Open as administrator' : 'Open with sudo in terminal');
  const elevated = () => { void openInTerminal(file, true).catch(reason => useToastStore.getState().addToast(String(reason), 'error')); };
  useEffect(() => {
    if (!focused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault(); event.stopImmediatePropagation(); void saveDocument(file, event.shiftKey);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focused, file]);
  return <section className="editor-pane" data-testid={active ? 'file-editor' : undefined} style={{ display: active ? 'flex' : 'none' }} inert={!active}>
    <WorkspaceHeader active={active}><FolderTabs items={active ? codeTabs.items : []} selected={`file:${editorFileKey(file)}`} label={t('Open files and comparisons')} listId="code-documents" className="editor-tabs"
      onSelect={codeTabs.onSelect} onClose={codeTabs.onClose}
      onMove={codeTabs.onMove} menuItems={[
        { label: t('New file'), onClick: newEditorFile },
        { label: t('Open file'), onClick: () => void openWorkspaceFile() },
        { label: t('Save file'), disabled: !canSave, shortcut: 'Ctrl/Cmd+S', onClick: save },
        { label: t('Save as…'), disabled: !document || document.loading || document.saving || document.kind !== 'text', shortcut: 'Ctrl/Cmd+Shift+S', onClick: saveAs },
        { label: t('Reload file'), disabled: !!file.draftId || document?.saving, onClick: reloadFile },
        { label: t('Undo'), group: 'edit', disabled: !canEdit, shortcut: 'Ctrl/Cmd+Z', onClick: () => run('undo') },
        { label: t('Redo'), group: 'edit', disabled: !canEdit, shortcut: 'Ctrl/Cmd+Shift+Z', onClick: () => run('redo') },
        { label: t('Select all'), group: 'edit', onClick: () => run('editor.action.selectAll') },
        { label: t('Find'), group: 'edit', shortcut: 'Ctrl/Cmd+F', onClick: () => run('actions.find') },
        { label: t('Replace'), group: 'edit', disabled: !canEdit, shortcut: 'Ctrl/Cmd+H', onClick: () => run('editor.action.startFindReplaceAction') },
        { label: t('Word wrap'), group: 'view', checked: preferences.wordWrap, onClick: () => preferences.update({ wordWrap: !preferences.wordWrap }) },
        { label: t('Vim mode'), group: 'view', checked: preferences.vimMode, onClick: () => preferences.update({ vimMode: !preferences.vimMode }) },
        { label: t('Show line numbers'), group: 'view', checked: preferences.lineNumbers, onClick: () => preferences.update({ lineNumbers: !preferences.lineNumbers }) },
        ...(!file.draftId ? [{ label: t('Open in terminal'), group: 'view' as const, onClick: terminal }, { label: elevatedLabel, group: 'view' as const, onClick: elevated }] : []),
        { label: t('Discard changes'), group: 'danger', disabled: !dirty || document?.saving, onClick: () => setReload(true) },
      ]} toolbar={<>
        <WorkspaceResourceSwitcher />
        {markdown && <IconButton compact aria-label={t('Markdown preview')} aria-pressed={preview} data-tip={t('Markdown preview')} onClick={() => setPreview(value => !value)}>{preview ? <EyeOff size={iconSizes.control} /> : <Eye size={iconSizes.control} />}</IconButton>}
        <span className="folder-action-secondary"><IconButton compact aria-label={t('Undo')} data-tip={t('Undo')} disabled={!canEdit} onClick={() => run('undo')}><Undo2 size={iconSizes.control} /></IconButton><IconButton compact aria-label={t('Redo')} data-tip={t('Redo')} disabled={!canEdit} onClick={() => run('redo')}><RotateCw size={iconSizes.control} /></IconButton><IconButton compact aria-label={t('Find')} data-tip={t('Find')} onClick={() => run('actions.find')}><Search size={iconSizes.control} /></IconButton></span>
        {!file.draftId && <><span className="folder-action-secondary"><ReloadButton compact label={t('Reload file')} busy={document?.loading} disabled={document?.saving} onReload={reloadFile} /></span><TextButton className="folder-action-secondary" onClick={terminal}>{t('Open in terminal')}</TextButton></>}
        <IconButton compact aria-label={t('Save file')} data-tip={t('Save file (Ctrl/Cmd+S)')} disabled={!canSave} onClick={save}><Save size={iconSizes.control} /></IconButton>
        <IconButton compact className="workspace-open-action" aria-label={t('Open file')} data-tip={t('Open file')} onClick={() => void openWorkspaceFile()}><FolderOpen size={iconSizes.control} /></IconButton>
        <IconButton compact className="workspace-create-action" aria-label={t('New file')} data-tip={t('New file')} onClick={newEditorFile}><Plus size={iconSizes.control} /></IconButton>
      </>} /></WorkspaceHeader>
    {document?.error && <ErrorBox title={t('Could not read or save file')} details={document.error} />}
    {(!document || document.loading) && <div className="code-diff-status" role="status">{t('Loading file…')}</div>}
    {document && !document.loading && document.kind !== 'text' && <div className="code-diff-status">{t(document.kind === 'binary' ? 'This file is binary or is not UTF-8. Open it with another editor.' : 'This file is too large for the embedded editor.')}</div>}
    {document && !document.loading && !!document.revision && document.kind === 'text' && <CodeEditor path={file.path} value={document.value} active={focused} readOnly={document.readOnly} wordWrap={preferences.wordWrap} vimMode={preferences.vimMode} onReady={handle => { editor.current = handle; }} onChange={value => useEditorDocuments.getState().edit(file, value)} onSave={save}
      onVimCommand={command => executeEditorVimCommand(file, command)} preview={preview && markdown ? <SafeMarkdown content={document.value} paneId={null} /> : undefined}
      status={<><span className="folder-path editor-status-path" data-testid="editor-file-path" data-tip={file.connectionId ? file.path : normPath(file.path)}><span>{file.connectionId ? file.path : normPath(file.path)}{dirty ? ' •' : ''}{file.draftId ? ` · ${t('Not saved')}` : ''}</span></span>{document.readOnly && <ReadOnlyFileAccess file={file} permissionDenied={document.permissionDenied} active={active} />}<TextButton aria-label={t('Character encoding')} onClick={event => { const trigger = event.currentTarget; const box = trigger.getBoundingClientRect(); setEncodingMenu({ x: box.left, y: box.top, above: trigger, trigger }); }}>{EDITOR_ENCODINGS[document.encoding ?? 'utf8']}</TextButton></>} />}
    {document?.kind === 'binary' && <TextButton onClick={event => { const trigger = event.currentTarget; const box = trigger.getBoundingClientRect(); setEncodingMenu({ x: box.left, y: box.bottom, trigger }); }}>{t('Reopen with encoding')}</TextButton>}
    {encodingMenu && <ContextMenu anchor={encodingMenu} label={t('Character encoding')} onClose={() => setEncodingMenu(null)} items={[
      ...(!file.draftId ? [{ label: t('Reopen with encoding'), submenu: { items: (Object.entries(EDITOR_ENCODINGS) as [EditorEncoding, string][]).map(([encoding, label]) => ({ label, checked: document?.encoding === encoding, onClick: () => { if (dirty) setReopenEncoding(encoding); else void useEditorDocuments.getState().load(file, true, encoding); } })) } }] : []),
      { label: t('Save with encoding'), submenu: { items: (Object.entries(EDITOR_ENCODINGS) as [EditorEncoding, string][]).map(([encoding, label]) => ({ label, checked: document?.encoding === encoding, disabled: !canEdit, onClick: () => { if (file.draftId) { useEditorDocuments.getState().setDraftEncoding(file, encoding); void saveDocument(file); } else void useEditorDocuments.getState().save(file, encoding); } })) } },
    ]} />}
    <ConfirmDialog open={reopenEncoding !== null} title={t('Reopen with encoding')} message={t('Reload this file and discard your unsaved changes?')} confirmLabel={t('Reload')} cancelLabel={t('Cancel')} onCancel={() => setReopenEncoding(null)} onConfirm={() => { const encoding = reopenEncoding; setReopenEncoding(null); if (encoding) void useEditorDocuments.getState().load(file, true, encoding); }} />
    <ConfirmDialog open={reload} title={t(file.draftId ? 'Discard changes' : 'Reload file')} message={t('Reload this file and discard your unsaved changes?')} confirmLabel={t(file.draftId ? 'Discard changes' : 'Reload')} cancelLabel={t('Cancel')} onCancel={() => setReload(false)} onConfirm={() => { setReload(false); void load(); }} />
  </section>;
}
