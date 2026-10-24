import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { editor } from 'monaco-editor';
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import { ArrowDown, ArrowUp, iconSizes } from '@ui/icons';
import ErrorBox from '@ui/feedback/ErrorBox';
import { TextButton } from '@ui/actions/TextButton';
import { diagnostic } from '@platform/diagnostics';
import '@ui/editor/CodeDiff.css';

type Runtime = typeof import('@ui/editor/code/runtime');

/** Lazily load the comparison surface and keep its models local to this instance. */
export default function CodeDiff({ original, modified, path, sideBySide, originalLabel, modifiedLabel, onLayoutChange, toolbar, notice }: {
  original: string; modified: string; path: string; sideBySide: boolean; originalLabel: string; modifiedLabel: string; onLayoutChange?: (split: boolean) => void;
  toolbar?: (navigation: ReactNode, navigate: (direction: 'previous' | 'next') => void) => ReactNode; notice?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<{ view: editor.IStandaloneDiffEditor; original: editor.ITextModel; modified: editor.ITextModel; runtime: Runtime } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(0);
  const split = sideBySide && width >= 640;
  useEffect(() => {
    if (width > 0 && split !== sideBySide) onLayoutChange?.(split);
  }, [width, split, sideBySide, onLayoutChange]);
  useEffect(() => {
    if (!host.current) return;
    const resize = () => {
      const element = host.current;
      if (!element) return;
      const { width: nextWidth, height } = element.getBoundingClientRect();
      setWidth(nextWidth);
      if (nextWidth > 0 && height > 0) instance.current?.view.layout({ width: nextWidth, height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | undefined;
    let frame = 0;
    setError('');
    diagnostic('code-diff-load', { stage: 'start' });
    void import('@ui/editor/code/runtime').then(runtime => {
      if (disposed || !host.current) return;
      runtime.applyCodeTheme();
      const style = getComputedStyle(document.documentElement);
      const view = runtime.editorApi.editor.createDiffEditor(host.current, {
        automaticLayout: false, readOnly: true, originalEditable: false, ignoreTrimWhitespace: false,
        minimap: { enabled: false }, scrollBeyondLastLine: false, renderOverviewRuler: false,
        overviewRulerLanes: 0, overviewRulerBorder: false, hideCursorInOverviewRuler: true,
        renderSideBySide: false, useInlineViewWhenSpaceIsLimited: false,
        enableSplitViewResizing: true, contextmenu: false,
        scrollbar: { useShadows: false }, renderMarginRevertIcon: false,
        fontFamily: style.getPropertyValue('--font-mono').trim(), fontSize: 13,
        theme: 'workspace-code', hideUnchangedRegions: { enabled: true },
        accessibilityVerbose: false, padding: { top: 8 },
      });
      const originalModel = runtime.editorApi.editor.createModel('');
      const modifiedModel = runtime.editorApi.editor.createModel('');
      view.setModel({ original: originalModel, modified: modifiedModel });
      instance.current = { view, original: originalModel, modified: modifiedModel, runtime };
      const bounds = host.current.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) view.layout({ width: bounds.width, height: bounds.height });
      observer = new MutationObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => runtime.applyCodeTheme());
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
      setReady(true);
      diagnostic('code-diff-load', { stage: 'complete' });
    }).catch(reason => {
      if (!disposed) { setError(String(reason)); diagnostic('code-diff-load', { stage: 'error' }, 'error'); }
    });
    return () => {
      disposed = true;
      observer?.disconnect(); cancelAnimationFrame(frame);
      const current = instance.current;
      instance.current = null;
      current?.view.dispose(); current?.original.dispose(); current?.modified.dispose();
    };
  }, [attempt]);
  useEffect(() => {
    const current = instance.current;
    if (!ready || !current) return;
    const state = current.view.saveViewState();
    if (current.original.getValue() !== original) current.original.setValue(original);
    if (current.modified.getValue() !== modified) current.modified.setValue(modified);
    const language = current.runtime.languageForFile(path);
    current.runtime.editorApi.editor.setModelLanguage(current.original, language);
    current.runtime.editorApi.editor.setModelLanguage(current.modified, language);
    current.view.updateOptions({ renderSideBySide: split });
    current.view.getOriginalEditor().updateOptions({ ariaLabel: originalLabel });
    current.view.getModifiedEditor().updateOptions({ ariaLabel: modifiedLabel });
    if (state) current.view.restoreViewState(state);
  }, [ready, original, modified, path, split, originalLabel, modifiedLabel]);
  const navigation = <>
      <IconButton compact aria-label={t('Previous change')} data-tip={t('Previous change')} disabled={!ready}
        onClick={() => instance.current?.view.goToDiff('previous')}><ArrowUp size={iconSizes.compact} /></IconButton>
      <IconButton compact aria-label={t('Next change')} data-tip={t('Next change')} disabled={!ready}
        onClick={() => instance.current?.view.goToDiff('next')}><ArrowDown size={iconSizes.compact} /></IconButton>
  </>;
  return <div className="code-diff" data-testid="code-diff" data-layout={split ? 'split' : 'inline'}>
    {toolbar ? toolbar(navigation, direction => instance.current?.view.goToDiff(direction)) : <div className="code-diff-labels"><span>{originalLabel}{!split && <> → {modifiedLabel}</>}</span>{split && <span>{modifiedLabel}</span>}{navigation}</div>}
    {notice}
    {toolbar && split && <div className="code-diff-labels code-diff-side-labels"><span>{originalLabel}</span><span>{modifiedLabel}</span></div>}
    {!ready && !error && <div className="code-diff-status" role="status">{t('Loading comparison…')}</div>}
    {error && <ErrorBox title={t('Could not load comparison')} details={error} actions={<TextButton onClick={() => { setReady(false); setAttempt(value => value + 1); }}>{t('Retry')}</TextButton>} />}
    <div className="code-diff-frame"><div ref={host} className="code-diff-host" style={{ visibility: ready ? 'visible' : 'hidden' }} /></div>
  </div>;
}
