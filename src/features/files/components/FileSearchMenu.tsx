import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FsEntry } from '@platform/api/types';
import type { FileOps } from '../model/fileOps';
import { searchFiles, type FileSearchResult } from '../services/fileSearch';
import { TextInput } from '@ui/fields/TextInput';
import ErrorBox from '@ui/feedback/ErrorBox';
import { t } from '@i18n';
import { useListNavigationMode } from '@ui/hooks/useListNavigationMode';

export default function FileSearchMenu({ ops, root, onChoose, onClose, returnFocus }: {
  ops: FileOps; root: string; onChoose: (entry: FsEntry) => void; onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FileSearchResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDivElement>(null);
  const navigation = useListNavigationMode(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input,button') ?? []);
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const results = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('[data-file-search-result]') ?? []);
        if (results.length) {
          const index = results.findIndex((item) => item === document.activeElement);
          const next = index < 0 ? 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
          event.preventDefault(); event.stopPropagation(); results[next]?.focus();
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined); setError(undefined); setBusy(!!query.trim());
    const timer = setTimeout(() => {
      if (!query.trim()) return;
      void searchFiles(ops, root, query, controller.signal, (next) => {
        if (!controller.signal.aborted) setResult(next);
      }).then((next) => { if (!controller.signal.aborted) setResult(next); })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(String((cause as Error)?.message ?? cause)); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [ops, query, root]);
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 9997, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={onClose}>
    <div {...navigation.props} ref={dialog} className="workspace-floating workspace-floating-dialog" role="dialog" aria-modal="true" aria-label={t('Search files')}
      data-testid="file-search-menu" onClick={(event) => event.stopPropagation()}
      style={{ width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: '70vh', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{t('Search files')}</strong><button onClick={onClose}>{t('Close search')}</button>
      </div>
      <div style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{root}</div>
      <TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('File name')}
        placeholder={t('Search file names in this directory and its subdirectories')}
        style={{ background: 'var(--field-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)', padding: 8, borderRadius: 'var(--radius-inner)' }} />
      {busy && <div role="status">{t('Searching files…')}</div>}
      {error && <ErrorBox title={t('Could not search files')} details={error}>{t('Check the directory and connection, then try again.')}</ErrorBox>}
      <div className="scroll-region" style={{ overflowY: 'auto', minHeight: 0 }}>
        {result?.entries.map((entry) => <button key={entry.path} data-file-search-result onClick={() => onChoose(entry)}
          className="workspace-floating-row" style={{ display: 'block', width: '100%', padding: 8, textAlign: 'left', color: 'var(--text-primary)', border: 'none', overflowWrap: 'anywhere' }}>
          <div>{entry.name}{entry.is_dir ? '/' : ''}</div><div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-label)' }}>{entry.path}</div>
        </button>)}
      </div>
      {!busy && result && !result.entries.length && !error && <div className="search-empty-state">{t('No matching files')}</div>}
      {result?.truncated && <div style={{ color: 'var(--text-muted)' }}>{t('Search limit reached. Use a narrower directory or a more specific file name.')}</div>}
      {!!result?.skipped && <div style={{ color: 'var(--text-muted)' }}>{t('Some subdirectories could not be read.')}</div>}
    </div>
  </div>, document.body);
}
