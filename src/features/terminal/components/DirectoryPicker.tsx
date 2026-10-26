import { useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { Folder, ArrowUp, iconSizes } from '@ui/icons';
import { TextInput } from '@ui/fields/TextInput';
import { useToastStore } from '@ui/feedback/Toast';
import ErrorBox from '@ui/feedback/ErrorBox';
import { clampMenuPosition } from '@ui/menus/menuPosition';
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
import { useListNavigationMode } from '@ui/hooks/useListNavigationMode';

/** Browse the current pane's directory without changing its input draft. */
export default function DirectoryPicker({ paneId, dir }: { paneId: string; dir?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigation = useListNavigationMode();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 280 });
  const spec = useSessionStore(state => state.tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout) : []).find(pane => pane.id === paneId));
  const session = useTerminalStore(state => state.sessions[paneId]);
  const shellType = useTerminalStore(state => state.shellTypes?.[paneId]) ?? spec?.shellType;
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
  const options = useMemo(() => entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [entries, query]);

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
        const width = Math.min(280, window.innerWidth - 16);
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
  useEffect(() => { setActive(-1); }, [query, entries]);
  useEffect(() => {
    if (navigation.keyboardNavigation) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId, navigation.keyboardNavigation]);

  const choose = async (target: string) => {
    const currentSession = useTerminalStore.getState().sessions[paneId];
    if (!connected || !currentSession || useBlockStore.getState().byTab[paneId]?.some(block => block.status === 'executing' || block.snapshotPending)) return;
    try {
      const command = directoryCommand(target, spec?.kind === 'local' ? shellType : 'zsh');
      setPendingTerminalCommand(paneId, command);
      await ptyWrite(currentSession, command + '\n');
      engageFollow(paneId);
      setOpen(false);
      trigger.current?.closest('.terminal-composer')?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    } catch (reason) { useToastStore.getState().addToast(`${t('Unable to change directory')}: ${String(reason instanceof Error ? reason.message : reason)}`, 'error'); }
  };

  return <>
    <button ref={trigger} className="directory-picker-trigger terminal-chip" type="button" data-subtle disabled={!path || !connected || busy}
      data-tip={path} aria-label={t('Change working directory')} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => { setQuery(''); setActive(-1); setOpen(value => !value); }}>
      <Folder size={iconSizes.compact} /><span>{path ? directoryLabel(path) : t('Working directory unavailable')}</span>
    </button>
    {open && createPortal(<div {...navigation.props} ref={menu} className="workspace-floating directory-picker" role="dialog" aria-label={t('Choose working directory')}
      style={{ position: 'fixed', zIndex: 10000, ...position }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        else if (event.target === search.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault(); event.stopPropagation();
          setActive(value => options.length ? (value < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (value + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length) : -1);
        } else if (event.target === search.current && event.key === 'Enter' && options[Math.max(0, active)] && !loading) { event.preventDefault(); event.stopPropagation(); void choose(options[Math.max(0, active)]!.path); }
      }}>
      <TextInput ref={search} className="directory-picker-search" value={query} placeholder={t('Search directories…')}
        aria-label={t('Search directories')} role="combobox" aria-expanded="true" aria-controls={listId}
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined} onChange={event => setQuery(event.target.value)} />
      {parent && <button className="directory-picker-parent workspace-floating-row" type="button" data-subtle onClick={() => void choose(parent)}>
        <ArrowUp size={iconSizes.compact} /><span>{t('Parent directory')}</span>
      </button>}
      {error ? <ErrorBox title={t('Unable to read directory')} actions={<button type="button" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button>}>{error}</ErrorBox>
        : loading ? <p role="status">{t('Loading directories…')}</p> : <div id={listId} role="listbox" aria-label={t('Directories')} className="directory-picker-list">
          {options.map((option, index) => <button type="button" data-subtle role="option" className="workspace-floating-row" aria-selected={active === index} data-active={navigation.keyboardNavigation && active === index} tabIndex={-1}
            id={`${listId}-${index}`} key={option.path} onPointerMove={() => { if (navigation.pointerMoved.current) setActive(-1); }} onMouseDown={event => event.preventDefault()}
            onClick={() => void choose(option.path)}>
            <Folder size={iconSizes.compact} /><span>{option.name}</span>
          </button>)}
          {!options.length && <p className="search-empty-state">{t('No matching directories')}</p>}
        </div>}
    </div>, document.body)}
  </>;
}
