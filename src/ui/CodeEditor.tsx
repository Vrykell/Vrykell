import { useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import ErrorBox from './ErrorBox';
import { t } from '@i18n';
import './CodeDiff.css';
type Runtime = typeof import('./code/runtime');

export default function CodeEditor({ path, value, onChange, onSave, active = true }: { path: string; value: string; onChange: (value: string) => void; onSave: () => void; active?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef({ value, onChange, onSave }); current.current = { value, onChange, onSave };
  const instance = useRef<{ view: editor.IStandaloneCodeEditor; model: editor.ITextModel } | null>(null);
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false; let runtime: Runtime | undefined; let observer: MutationObserver | undefined;
    const resize = new ResizeObserver(() => { const bounds = host.current?.getBoundingClientRect(); if (bounds?.width && bounds.height) instance.current?.view.layout({ width: bounds.width, height: bounds.height }); });
    if (host.current) resize.observe(host.current);
    void import('./code/runtime').then(loaded => {
      runtime = loaded; if (disposed || !host.current) return;
      runtime.applyCodeTheme();
      const model = runtime.editorApi.editor.createModel(current.current.value, runtime.languageForFile(path));
      const style = getComputedStyle(document.documentElement);
      const view = runtime.editorApi.editor.create(host.current, { model, theme: 'workspace-code', automaticLayout: false, minimap: { enabled: false },
        scrollBeyondLastLine: false, scrollbar: { useShadows: false }, overviewRulerLanes: 0, overviewRulerBorder: false, hideCursorInOverviewRuler: true,
        fontFamily: style.getPropertyValue('--font-mono').trim(), fontSize: 13, padding: { top: 8 }, contextmenu: false, ariaLabel: t('Edit {{path}}', { path }) });
      instance.current = { view, model }; view.layout();
      model.onDidChangeContent(() => current.current.onChange(model.getValue(undefined, true)));
      view.addCommand(runtime.editorApi.KeyMod.CtrlCmd | runtime.editorApi.KeyCode.KeyS, () => current.current.onSave());
      observer = new MutationObserver(() => runtime?.applyCodeTheme()); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
      setReady(true);
    }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; observer?.disconnect(); resize.disconnect(); instance.current?.view.dispose(); instance.current?.model.dispose(); instance.current = null; };
  }, [path]);
  useEffect(() => { const model = instance.current?.model; if (model && model.getValue(undefined, true) !== value) model.setValue(value); }, [value, ready]);
  useEffect(() => { if (ready && active) instance.current?.view.focus(); }, [ready, active]);
  return <div className="code-editor" data-testid="code-editor">
    {error && <ErrorBox title={t('Could not load editor')} details={error} />}
    {!ready && !error && <div className="code-diff-status" role="status">{t('Loading editor…')}</div>}
    <div className="code-editor-frame"><div ref={host} className="code-diff-host" /></div>
  </div>;
}
