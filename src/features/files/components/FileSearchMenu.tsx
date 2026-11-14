import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FsEntry } from '@platform/api/types';
import type { FileOps } from '../model/fileOps';
import { searchFiles, type FileSearchResult } from '../services/fileSearch';
import { TextInput } from '@ui/fields/TextInput';
import ErrorBox from '@ui/feedback/ErrorBox';
import { IconButton } from '@ui/actions/IconButton';
import { X } from '@ui/icons';
import { t } from '@i18n';
import { useListNavigationMode } from '@ui/hooks/useListNavigationMode';
import './FileSearchMenu.css';

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
  return createPortal(<div className="file-search-overlay"
    onClick={onClose}>
    <div {...navigation.props} ref={dialog} className="workspace-floating workspace-floating-dialog file-search-dialog" role="dialog" aria-modal="true" aria-label={t('Search files')}
      data-testid="file-search-menu" onClick={(event) => event.stopPropagation()}>
      <header className="file-search-header">
        <div className="file-search-query">
          <TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('File name')}
            placeholder={t('Search file names in this directory and its subdirectories')} />
          <IconButton compact aria-label={t('Close search')} data-tip={t('Close search')} data-tip-shortcut="Escape" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="file-search-root">{root}</div>
      </header>
      <div className="file-search-body scroll-region">
        {busy && <div className="file-search-message" role="status">{t('Searching files…')}</div>}
        {error && <ErrorBox title={t('Could not search files')} details={error}>{t('Check the directory and connection, then try again.')}</ErrorBox>}
        {result?.entries.map((entry) => <button key={entry.path} data-file-search-result onClick={() => onChoose(entry)}
          className="workspace-floating-row file-search-row">
          <span className="file-search-name">{entry.name}{entry.is_dir ? '/' : ''}</span>
          <span className="file-search-path">{entry.path}</span>
        </button>)}
        {!busy && result && !result.entries.length && !error && <div className="search-empty-state">{t('No matching files')}</div>}
        {result?.truncated && <div className="file-search-note">{t('Search limit reached. Use a narrower directory or a more specific file name.')}</div>}
        {!!result?.skipped && <div className="file-search-note">{t('Some subdirectories could not be read.')}</div>}
      </div>
    </div>
  </div>, document.body);
}
