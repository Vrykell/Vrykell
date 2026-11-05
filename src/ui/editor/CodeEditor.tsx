import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { editor } from 'monaco-editor';
import { terminalFontFamily, useTypographyStore } from '@config/typography';
import { useEditorPreferences } from '@config/editor';
import { diagnostic } from '@platform/diagnostics';
import type { EditorVimCommand } from '@core/editor';
import { bindEditorVimCommands, registerEditorVimCommands, type VimApi } from '@ui/editor/code/vimCommands';
import { guardModalComposition } from '@ui/editor/code/modalCompositionGuard';
import { replayVimText } from '@ui/editor/code/vimInput';
import { registerEditorChangeFlush } from '@ui/editor/code/pendingChanges';
import { useToastStore } from '@ui/feedback/Toast';
import ErrorBox from '@ui/feedback/ErrorBox';
import { t } from '@i18n';
import '@ui/editor/CodeDiff.css';
type Runtime = typeof import('@ui/editor/code/runtime');
export type EditorCommand = 'undo' | 'redo' | 'actions.find' | 'editor.action.startFindReplaceAction' | 'editor.action.selectAll';
export interface CodeEditorHandle { run: (command: EditorCommand) => void }
/** Coalesce held keys into one document update instead of one workspace render per character. */
const EDIT_CHANGE_FLUSH_MS = 120;

export default function CodeEditor({ path, value, onChange, onSave, onVimCommand, active = true, readOnly = false, wordWrap = false, vimMode = false, onReady, preview, status }: { path: string; value: string; onChange: (value: string) => void; onSave: () => void; onVimCommand?: (command: EditorVimCommand) => Promise<unknown> | void; active?: boolean; readOnly?: boolean; wordWrap?: boolean; vimMode?: boolean; onReady?: (handle: CodeEditorHandle | null) => void; preview?: ReactNode; status?: ReactNode }) {
  const previewing = preview !== undefined;
  const lineNumbers = useEditorPreferences(state => state.lineNumbers);
  const fontSize = useTypographyStore(state => state.editorFontSize);
  const fontPreset = useTypographyStore(state => state.editorFontPreset);
  const fontWeight = useTypographyStore(state => state.editorFontWeight);
  const lineHeight = useTypographyStore(state => state.editorLineHeight);
  const host = useRef<HTMLDivElement>(null);
  const vimStatus = useRef<HTMLDivElement>(null);
  const current = useRef({ value, onChange, onSave, readOnly, onVimCommand }); current.current = { value, onChange, onSave, readOnly, onVimCommand };
  const [vimPrompt, setVimPrompt] = useState(false);
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  const instance = useRef<{ view: editor.IStandaloneCodeEditor; model: editor.ITextModel } | null>(null);
  /** Last value handed to the document store; a newer model value must never be rewound to it. */
  const reported = useRef<string | null>(null);
  const applyingExternal = useRef(false);
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const [position, setPosition] = useState({ lineNumber: 1, column: 1 });
  /** Line endings change only with the document; cursor moves re-render without scanning the text. */
  const eol = useMemo(() => value.includes('\r\n') ? 'CRLF' : 'LF', [value]);
  useEffect(() => {
    setReady(false); setError('');
    let disposed = false; let runtime: Runtime | undefined; let observer: MutationObserver | undefined; let unbindVim: (() => void) | undefined; let cleanupEditor: (() => void) | undefined;
    diagnostic('code-editor-load', { stage: 'start' });
    const resize = new ResizeObserver(() => { const bounds = host.current?.getBoundingClientRect(); if (bounds?.width && bounds.height) instance.current?.view.layout({ width: bounds.width, height: bounds.height }); });
    if (host.current) resize.observe(host.current);
    void import('@ui/editor/code/runtime').then(loaded => {
      runtime = loaded; if (disposed || !host.current) return;
      runtime.applyCodeTheme();
      // The model belongs to this path; cleanup reports through the callback captured here even if
      // the pane has already moved on to another file.
      const owner = current.current;
      const model = runtime.editorApi.editor.createModel(current.current.value, runtime.languageForFile(path));
      const typography = useTypographyStore.getState();
      const view = runtime.editorApi.editor.create(host.current, { model, theme: 'workspace-code', automaticLayout: false, minimap: { enabled: false },
        readOnly: current.current.readOnly, scrollBeyondLastLine: false, scrollbar: { useShadows: false }, overviewRulerLanes: 0, overviewRulerBorder: false, hideCursorInOverviewRuler: true,
        wordWrap: wordWrap ? 'on' : 'off', find: { addExtraSpaceOnTop: false }, folding: false, lineNumbers: useEditorPreferences.getState().lineNumbers ? 'on' : 'off', lineNumbersMinChars: 3, glyphMargin: false, lineDecorationsWidth: 16, renderLineHighlight: 'none',
        quickSuggestions: false, suggestOnTriggerCharacters: false, parameterHints: { enabled: false }, lightbulb: { enabled: runtime.editorApi.editor.ShowLightbulbIconMode.Off },
        fontFamily: terminalFontFamily(typography.editorFontPreset), fontSize: typography.editorFontSize, fontWeight: String(typography.editorFontWeight), lineHeight: typography.editorFontSize * typography.editorLineHeight, padding: { top: 8, bottom: 8 }, contextmenu: false, ariaLabel: t('Edit {{path}}', { path }) });
      instance.current = { view, model }; view.layout();
      let changeTimer: ReturnType<typeof setTimeout> | null = null;
      let changePending = false;
      /** `notify` defaults to the latest props; cleanup passes the file that owned this model. */
      const flushChange = (notify: (value: string) => void = current.current.onChange) => {
        if (changeTimer !== null) { clearTimeout(changeTimer); changeTimer = null; }
        if (!changePending) return;
        changePending = false;
        const next = model.getValue(undefined, true);
        reported.current = next;
        notify(next);
      };
      const unregisterFlush = registerEditorChangeFlush(flushChange);
      model.onDidChangeContent(() => {
        if (applyingExternal.current) return;
        changePending = true;
        // Trailing coalescing: a held key keeps pushing the flush out, so the workspace only renders
        // once the user pauses. Save, blur, hiding and unmounting flush immediately instead.
        if (changeTimer !== null) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => flushChange(), EDIT_CHANGE_FLUSH_MS);
      });
      const save = () => { flushChange(); current.current.onSave(); };
      view.addCommand(runtime.editorApi.KeyMod.CtrlCmd | runtime.editorApi.KeyCode.KeyS, save);
      view.onDidChangeCursorPosition(event => setPosition(event.position));
      readyCallback.current?.({ run: command => { view.focus(); view.trigger('document-toolbar', command, null); } });
      unbindVim = bindEditorVimCommands(view, command => {
        flushChange();
        return current.current.onVimCommand ? current.current.onVimCommand(command) : command.action === 'write' && !command.args && !command.ranged ? current.current.onSave() : undefined;
      });
      const blurListener = view.onDidBlurEditorText?.(() => flushChange());
      const onVisibility = () => { if (document.visibilityState === 'hidden') flushChange(); };
      document.addEventListener('visibilitychange', onVisibility);
      observer = new MutationObserver(() => runtime?.applyCodeTheme()); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
      setReady(true);
      diagnostic('code-editor-load', { stage: 'complete' });
      const disposeEditor = () => {
        flushChange(owner.onChange);
        unregisterFlush();
        blurListener?.dispose();
        document.removeEventListener('visibilitychange', onVisibility);
      };
      cleanupEditor = disposeEditor;
    }).catch(reason => { if (!disposed) { setError(String(reason)); diagnostic('code-editor-load', { stage: 'error', error: reason }, 'error'); } });
    return () => { disposed = true; cleanupEditor?.(); observer?.disconnect(); resize.disconnect(); unbindVim?.(); readyCallback.current?.(null); instance.current?.view.dispose(); instance.current?.model.dispose(); instance.current = null; };
  }, [path]);
  useEffect(() => {
    const model = instance.current?.model;
    if (!model) return;
    if (model.getValue(undefined, true) === value) { reported.current = null; return; }
    // A coalesced edit may still be ahead of the value prop; never rewind the model to it.
    if (value === reported.current) return;
    applyingExternal.current = true;
    try {
      model.setValue(value);
    } finally {
      applyingExternal.current = false;
    }
  }, [value, ready]);
  useEffect(() => { if (ready && active && !previewing) { instance.current?.view.layout(); instance.current?.view.focus(); } }, [ready, active, previewing]);
  useEffect(() => { instance.current?.view.updateOptions({ readOnly }); }, [ready, readOnly]);
  useEffect(() => { instance.current?.view.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' }); }, [ready, wordWrap]);
  useEffect(() => { instance.current?.view.updateOptions({ lineNumbers: lineNumbers ? 'on' : 'off' }); }, [ready, lineNumbers]);
  useEffect(() => { instance.current?.view.updateOptions({ fontFamily: terminalFontFamily(fontPreset), fontSize, fontWeight: String(fontWeight), lineHeight: fontSize * lineHeight }); }, [ready, fontSize, fontPreset, fontWeight, lineHeight]);
  useEffect(() => {
    let disposed = false; let adapter: { dispose: () => void } | undefined; let promptObserver: MutationObserver | undefined; let unguardComposition: (() => void) | undefined;
    if (ready && vimMode && !readOnly && instance.current) void import('monaco-vim').then(loaded => {
      if (disposed || !instance.current || !vimStatus.current) return;
      const bindings = 'default' in loaded && loaded.default && typeof loaded.default === 'object' ? loaded.default as typeof loaded : loaded;
      const { initVimMode, VimMode } = bindings;
      registerEditorVimCommands((VimMode as unknown as { Vim: VimApi }).Vim);
      const initialized = initVimMode(instance.current.view, vimStatus.current);
      let acceptsText = false;
      initialized.on('vim-mode-change', (change: { mode?: string }) => { acceptsText = change.mode === 'insert' || change.mode === 'replace'; });
      if (host.current) unguardComposition = guardModalComposition(host.current, () => acceptsText,
        text => replayVimText(initialized, vimStatus.current, text));
      initialized.openNotification = (content: unknown) => { const message = content instanceof Node ? content.textContent : String(content); if (message) useToastStore.getState().addToast(message, 'info'); };
      promptObserver = new MutationObserver(() => {
        const input = vimStatus.current?.querySelector('input');
        input?.setAttribute('aria-label', t('Vim command'));
        setVimPrompt(!!input);
      });
      promptObserver.observe(vimStatus.current, { childList: true, subtree: true });
      initialized.dispatch?.('vim-mode-change', { mode: 'normal' });
      adapter = initialized;
    }).catch(reason => { if (!disposed) { setError(String(reason)); diagnostic('code-editor-vim', { stage: 'error', error: reason }, 'error'); } });
    return () => { disposed = true; promptObserver?.disconnect(); unguardComposition?.(); adapter?.dispose(); setVimPrompt(false); };
  }, [ready, vimMode, readOnly]);
  return <div className="code-editor" data-testid="code-editor">
    {error && <ErrorBox title={t('Could not load editor')} details={error} />}
    {!ready && !error && <div className="code-diff-status" role="status">{t('Loading editor…')}</div>}
    <div className="code-editor-frame" style={{ display: previewing ? 'none' : undefined }}><div ref={host} className="code-diff-host" /></div>
    {previewing && <div className="code-editor-preview md scroll-region" data-testid="markdown-preview">{preview}</div>}
    <div className="code-editor-status" role="status" data-vim-prompt={vimPrompt || undefined}>{status}<div ref={vimStatus} className="code-editor-vim-status" hidden={!vimMode || readOnly} /><span className="code-editor-cursor">{t('Line {{line}}, column {{column}}', { line: position.lineNumber, column: position.column })}</span><span className="code-editor-count">{t('{{count}} characters', { count: value.length })}</span>{!status && <span>UTF-8</span>}<span>{eol}</span></div>
  </div>;
}
