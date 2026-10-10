import { useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { Folder, ArrowUp, iconSizes } from '@ui/icons';
import { TextInput } from '@ui/TextInput';
import { useToastStore } from '@ui/Toast';
import ErrorBox from '@ui/ErrorBox';
import { clampMenuPosition } from '@ui/menuPosition';
import { fileOpsFor, type FileOpsTarget } from '@features/files';
import { useSessionStore } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { useTerminalStore, useBlockStore, selectBlocks } from '@features/terminal';
import { ptyWrite } from '@platform/pty';
import { setPendingTerminalCommand } from '../hooks/useTerminalSession';
import { engageFollow } from '../hooks/useFollowBottom';
import { normalizeWorkingDirectory } from '../services/pipeline/workingDirectory';
import { directoryCommand, directoryLabel } from '../model/directoryCommand';
import type { FsEntry } from '@platform/api/types';

/** Browse the current pane's directory without changing its input draft. */
export default function DirectoryPicker({ paneId, dir }: { paneId: string; dir?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 320 });
  const spec = useSessionStore(state => state.tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout) : []).find(pane => pane.id === paneId));
  const session = useTerminalStore(state => state.sessions[paneId]);
  const blocks = useBlockStore(selectBlocks(paneId));
  const busy = blocks.some(block => block.status === 'executing' || block.snapshotPending);
  const connectionId = spec?.kind === 'ssh' ? spec.ssh?.connectionId : undefined;
  const ops = useMemo(() => {
    const target: FileOpsTarget = spec?.kind === 'ssh' ? { kind: 'ssh', connectionId: connectionId ?? '' } : { kind: 'local' };
    return fileOpsFor(target);
  }, [connectionId, spec?.kind]);
  const connected = !!session && (spec?.kind !== 'ssh' || !!connectionId);
  const path = dir ? normalizeWorkingDirectory(dir) : undefined;
  const parent = path ? ops.parentOf(path) : null;
  const options = useMemo(() => [
    ...(parent ? [{ path: parent, name: t('Parent directory'), parent: true }] : []),
    ...entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map(entry => ({ path: entry.path, name: entry.name, parent: false })),
  ], [entries, parent, query]);

  useEffect(() => { setOpen(false); }, [paneId, path, busy, connected]);
  useEffect(() => {
    if (!open || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    ops.list(path).then(result => {
      if (!cancelled) setEntries(result.entries.filter(entry => entry.is_dir).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(reason => { if (!cancelled) setError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, ops, path, retry]);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      const height = menu.current?.getBoundingClientRect().height ?? 240;
      if (bounds) {
        const width = Math.min(360, window.innerWidth - 16);
        const anchor = clampMenuPosition({ left: bounds.left, top: bounds.top - height - 6 }, { width, height }, { width: window.innerWidth, height: window.innerHeight });
        setPosition({ ...anchor, width });
      }
    };
    update();
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('resize', update);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', update); document.removeEventListener('pointerdown', outside); };
  }, [open, loading, error, options.length]);
  useEffect(() => { setActive(query && parent && options.length > 1 ? 1 : 0); }, [query, entries, parent, options.length]);
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, listId]);

  const choose = async (target: string) => {
    const currentSession = useTerminalStore.getState().sessions[paneId];
    if (!connected || !currentSession || useBlockStore.getState().byTab[paneId]?.some(block => block.status === 'executing' || block.snapshotPending)) return;
    try {
      const command = directoryCommand(target, spec?.kind === 'local' ? spec.shellType : 'zsh');
      setPendingTerminalCommand(paneId, command);
      await ptyWrite(currentSession, command + '\n');
      engageFollow(paneId);
      setOpen(false);
      trigger.current?.closest('.terminal-composer')?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    } catch (reason) { useToastStore.getState().addToast(`${t('Unable to change directory')}: ${String(reason instanceof Error ? reason.message : reason)}`, 'error'); }
  };

  return <>
    <button ref={trigger} className="directory-picker-trigger" type="button" data-subtle disabled={!path || !connected || busy}
      data-tip={path} aria-label={t('Change working directory')} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => { setQuery(''); setActive(0); setOpen(value => !value); }}>
      <Folder size={iconSizes.compact} /><span>{path ? directoryLabel(path) : t('Working directory unavailable')}</span>
    </button>
    {open && createPortal(<div ref={menu} className="workspace-floating directory-picker" role="dialog" aria-label={t('Choose working directory')}
      style={{ position: 'fixed', zIndex: 10000, ...position }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          setActive(value => options.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0);
        } else if (event.key === 'Enter' && options[active] && !loading) { event.preventDefault(); event.stopPropagation(); void choose(options[active]!.path); }
      }}>
      <TextInput ref={search} className="directory-picker-search" value={query} placeholder={t('Search directories…')}
        aria-label={t('Search directories')} role="combobox" aria-expanded="true" aria-controls={listId}
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined} onChange={event => setQuery(event.target.value)} />
      {error ? <ErrorBox title={t('Unable to read directory')} actions={<button type="button" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button>}>{error}</ErrorBox>
        : loading ? <p role="status">{t('Loading directories…')}</p> : <div id={listId} role="listbox" aria-label={t('Directories')} className="directory-picker-list">
          {options.map((option, index) => <button type="button" data-subtle role="option" aria-selected={active === index} tabIndex={-1}
            id={`${listId}-${index}`} key={option.path} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()}
            onClick={() => void choose(option.path)}>
            {option.parent ? <ArrowUp size={iconSizes.compact} /> : <Folder size={iconSizes.compact} />}
            {option.parent ? `.. (${option.name})` : option.name}
          </button>)}
          {!options.length && <p>{t('No matching directories')}</p>}
        </div>}
    </div>, document.body)}
  </>;
}
