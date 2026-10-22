import { preferredShell, useTerminalDefaults } from '@config/terminalDefaults';
import { loadRecentOpen } from '../model/tabTypes';
import { TextInput } from '@ui/TextInput';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { iconSizes, ChevronRight, Columns2, Folder, FolderOpen, Search, Settings, Square, SquareStack, TerminalPrompt } from '@ui/icons';
import KeyHint from '@ui/KeyHint';
import { SshIcon, shellIconFor } from '@ui/shellIcons';
import { getAvailableShells, type ShellOption, type ShellType } from '@platform/shells';
import { pickPath } from '@platform/api/fs';
import { openAppWindow } from '@platform/appWindows';
import { isMacOS } from '@platform/runtime';
import {
  buildNewTabOptions,
  filterNewTabOptions,
  touchRecentOpen,
  type NewTabOption,
} from '@features/workspace/model/tabTypes';
import { useSshStore, ensureSshLoaded } from '@features/ssh';
import { connectionTarget, type SshConnection } from '@features/ssh/services/api';
import { getFocusedCwd, useSessionStore, useUiStore } from '@features/workspace';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';
import { useAgentSettings } from '@features/agent';
import SshFormModal from '@features/ssh/components/SshFormModal';
import ContextMenu, { type ContextMenuItem } from '@ui/ContextMenu';
import ConfirmDialog from '@ui/ConfirmDialog';
import { useToastStore } from '@ui/Toast';
import { t } from '@i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Group id for the new tab (undefined = ungrouped). */
  groupId?: string;
  /**
   * When provided, picking a row returns the terminal spec instead of creating a tab
   * (split / replace flows).
   */
  onPick?: (spec: TerminalSpec) => void;
}

interface MenuState {
  x: number;
  y: number;
  option: NewTabOption;
  /** SSH connection snapshot for the right-clicked row (null for shells or missing connections). */
  conn: SshConnection | null;
}

/**
 * NewTabModal — the centered new-tab / terminal-type picker.
 * Candidates are the machine's shells plus saved SSH connections, most recently opened first,
 * filtered by the search field on top. Right-clicking a row opens that type's quick settings.
 */
export default function NewTabModal({ open, onClose, groupId, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<SshConnection | null>(null);
  const [deleting, setDeleting] = useState<SshConnection | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [location, setLocation] = useState<'current' | 'home' | 'custom'>('current');
  const [customCwd, setCustomCwd] = useState('');
  const defaultShell = useTerminalDefaults(state => state.shell);
  const openModeByShell = useAgentSettings(state => state.global.openModeByShell);
  const sshOpenMode = useAgentSettings(state => state.global.sshOpenMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sshConnections = useSshStore((s) => s.connections);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    setMenu(null);
    setEditing(null);
    setDeleting(null);
    setMoreOpen(false);
    setLocation('current');
    setCustomCwd('');
    ensureSshLoaded();
    let cancelled = false;
    getAvailableShells().then((s) => {
      if (!cancelled) setShells(s);
    });
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelled = true;
    };
  }, [open]);

  const options = useMemo(
    () => buildNewTabOptions(shells, sshConnections, loadRecentOpen(), defaultShell),
    [shells, sshConnections, defaultShell],
  );

  const filtered = useMemo(
    () => moreOpen ? filterNewTabOptions(options, query) : options,
    [options, query, moreOpen],
  );

  useEffect(() => setSelected(0), [query]);

  const targetCwd = location === 'current' ? getFocusedCwd() : location === 'custom' ? customCwd || undefined : undefined;
  const defaultOption = useMemo(() => {
    const preferred = preferredShell(defaultShell, shells);
    return options.find(option => option.kind === 'shell' && option.shellType === preferred)
      ?? options.find(option => option.kind === 'shell');
  }, [options, shells, defaultShell]);

  const create = useCallback((opt: NewTabOption) => {
    if (opt.kind === 'shell') {
      touchRecentOpen(opt.key);
      if (onPick) {
        onPick({ id: '', kind: 'local', shellType: opt.shellType });
        onClose();
        return;
      }
      useSessionStore.getState().addTab({ shellType: opt.shellType, groupId, cwd: targetCwd });
    } else {
      touchRecentOpen(opt.key);
      void useSshStore.getState().touch(opt.sshId);
      const conn = useSshStore.getState().connections.find((c) => c.id === opt.sshId);
      if (conn) {
        if (onPick) {
          onPick({
            id: '', kind: 'ssh',
            ssh: connectionTarget(conn),
          });
          onClose();
          return;
        }
      useSessionStore.getState().addTab({
          kind: 'ssh',
          ssh: connectionTarget(conn),
          groupId,
        });
      }
    }
    onClose();
  }, [onClose, groupId, onPick, targetCwd]);

  const chooseDirectory = useCallback(async () => {
    try {
      const [path] = await pickPath('directory');
      if (path) { setCustomCwd(path); setLocation('custom'); }
    } catch (reason) {
      useToastStore.getState().addToast(t('Could not open file: {{error}}', { error: String(reason) }), 'error');
    }
  }, []);

  const setShellMode = useCallback((shell: ShellType, mode: 'classic' | 'block') => {
    const current = useAgentSettings.getState().global.openModeByShell;
    useAgentSettings.getState().update({ openModeByShell: { ...current, [shell]: mode } });
  }, []);

  const setSshMode = useCallback((mode: 'classic' | 'block') => {
    useAgentSettings.getState().update({ sshOpenMode: mode });
  }, []);

  /** Persist one quick-config patch back onto the saved connection. */
  const saveConnection = useCallback((conn: SshConnection, patch: Partial<SshConnection>) => {
    void useSshStore.getState().save({ ...conn, ...patch }).catch((reason) => {
      useToastStore.getState().addToast(
        t('Could not save the SSH connection: {{error}}', { error: String((reason as Error)?.message ?? reason) }),
        'error',
      );
    });
  }, []);

  const removeConnection = useCallback((conn: SshConnection) => {
    void useSshStore.getState().remove(conn.id).catch((reason) => {
      useToastStore.getState().addToast(
        t('Could not delete the SSH connection: {{error}}', { error: String((reason as Error)?.message ?? reason) }),
        'error',
      );
    });
  }, []);

  const openMenu = useCallback((event: React.MouseEvent, option: NewTabOption) => {
    event.preventDefault();
    event.stopPropagation();
    const conn = option.kind === 'ssh'
      ? useSshStore.getState().connections.find((c) => c.id === option.sshId) ?? null
      : null;
    setMenu({ x: event.clientX, y: event.clientY, option, conn });
  }, []);

  /**
   * Quick settings for the right-clicked row: the terminal open mode always, plus
   * type-specific shortcuts — default terminal for shells, connection actions for SSH.
   */
  const buildMenuItems = (state: MenuState): ContextMenuItem[] => {
    if (state.option.kind === 'shell') {
      const shell = state.option.shellType;
      const mode = shell === 'cmd' ? 'classic' : openModeByShell[shell];
      const modes: ContextMenuItem[] = [
        { label: t('settings.openMode.classic'), checked: mode === 'classic', onClick: () => setShellMode(shell, 'classic') },
        ...(shell === 'cmd' ? [] : [{ label: t('settings.openMode.block'), checked: mode === 'block', onClick: () => setShellMode(shell, 'block') }]),
      ];
      return [
        {
          label: t('Set as default terminal'),
          checked: shell === preferredShell(defaultShell, shells),
          onClick: () => useTerminalDefaults.getState().setShell(shell),
        },
        ...(modes.length > 1 ? [{ label: t('Opening mode'), group: 'view' as const, submenu: { items: modes } }]
          : modes.map(item => ({ ...item, group: 'view' as const, disabled: true }))),
      ];
    }
    const conn = state.conn;
    if (!conn) return [];
    return [
      { label: t('Edit connection'), group: 'edit', onClick: () => setEditing(conn) },
      { label: t('Opening mode'), group: 'view', submenu: { items: [
        { label: t('settings.openMode.classic'), checked: sshOpenMode === 'classic', onClick: () => setSshMode('classic') },
        { label: t('settings.openMode.block'), checked: sshOpenMode === 'block', onClick: () => setSshMode('block') },
      ] } },
      // Missing flags follow the form defaults: shell integration on, auto reconnect off.
      { label: t('Shell integration'), group: 'organize', checked: conn.shellIntegration ?? true, onClick: () => saveConnection(conn, { shellIntegration: !(conn.shellIntegration ?? true) }) },
      { label: t('Auto reconnect'), group: 'organize', checked: conn.autoReconnect ?? false, onClick: () => saveConnection(conn, { autoReconnect: !(conn.autoReconnect ?? false) }) },
      { label: t('Delete connection'), danger: true, onClick: () => setDeleting(conn) },
    ];
  };

  const menuItems = menu ? buildMenuItems(menu) : [];

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[selected]; if (o) create(o); }
  }, [filtered, selected, create, onClose]);

  if (!open) return null;

  return <><div className="new-tab-overlay" onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="workspace-floating workspace-floating-dialog new-tab-dialog" role="dialog" aria-modal="true" aria-label={t('New tab')}
        onClick={event => event.stopPropagation()} onKeyDown={handleKey}>
        <button type="button" className="new-tab-default" data-testid="new-tab-default" disabled={!defaultOption}
          onClick={() => defaultOption && create(defaultOption)}>
          <span className="new-tab-primary-icon"><TerminalPrompt size={iconSizes.navigation} /></span>
          <span><strong>{t('New tab')}</strong><small>{t('Use the default profile')}</small></span>
          <KeyHint shortcut={isMacOS ? 'Meta+T' : 'Control+T'} />
        </button>

        <section className="new-tab-section" aria-labelledby="new-tab-profiles">
          <h2 id="new-tab-profiles">{t('Choose a profile')}</h2>
          <div className="new-tab-option-list">
            {filtered.map((option, index) => <OptionRow key={option.key} opt={option} index={index}
              selected={index === selected} onSelect={() => setSelected(index)} onCreate={() => create(option)}
              onContextMenu={event => { setSelected(index); openMenu(event, option); }} />)}
          </div>
          {!filtered.length && <div className="new-tab-empty">{t('No matching tab types')}</div>}
          <button type="button" className="new-tab-row new-tab-more" onClick={() => {
            setMoreOpen(true); requestAnimationFrame(() => inputRef.current?.focus());
          }}><Settings size={18} /><span>{t('More profiles…')}</span><ChevronRight size={16} /></button>
          {moreOpen && <div className="new-tab-search">
            <Search size={14} /><TextInput ref={inputRef} value={query} onChange={event => setQuery(event.target.value)}
              placeholder={t('Search tab types…')} />
          </div>}
        </section>

        <section className="new-tab-section" aria-labelledby="new-tab-location">
          <h2 id="new-tab-location">{t('Open location')}</h2>
          <button type="button" className="new-tab-row" data-active={location === 'current' || undefined}
            onClick={() => setLocation('current')}><Square size={18} /><span>{t('Open in current directory')}</span>
            <KeyHint shortcut={isMacOS ? 'Meta+Shift+T' : 'Control+Shift+T'} /></button>
          <button type="button" className="new-tab-row" data-active={location === 'home' || undefined}
            onClick={() => setLocation('home')}><FolderOpen size={18} /><span>{t('Open in home directory')}</span>
            <KeyHint shortcut={isMacOS ? 'Meta+Shift+H' : 'Control+Shift+H'} /></button>
          <button type="button" className="new-tab-row" data-active={location === 'custom' || undefined}
            onClick={() => void chooseDirectory()}><Folder size={18} /><span>{customCwd || t('Choose a directory…')}</span>
            <KeyHint shortcut={isMacOS ? 'Meta+Shift+O' : 'Control+Shift+O'} /></button>
        </section>

        <section className="new-tab-section" aria-labelledby="new-tab-advanced">
          <h2 id="new-tab-advanced">{t('Advanced')}</h2>
          <button type="button" className="new-tab-row" onClick={() => {
            try { void openAppWindow(); onClose(); }
            catch (reason) { useToastStore.getState().addToast(t('Could not open a new window: {{error}}', { error: String(reason) }), 'error'); }
          }}><SquareStack size={18} /><span>{t('Open in new window')}</span>
            <KeyHint shortcut={isMacOS ? 'Meta+N' : 'Control+N'} /></button>
          <button type="button" className="new-tab-row" onClick={() => {
            onClose(); useUiStore.getState().beginSplit(null);
          }}><Columns2 size={18} /><span>{t('Split tab')}</span><ChevronRight size={16} /></button>
        </section>
      </div>
    </div>

    {/* Row quick settings */}
    {menu && menuItems.length > 0 && (
      <ContextMenu anchor={{ x: menu.x, y: menu.y }} items={menuItems} onClose={() => setMenu(null)} />
    )}

    {/* Connection editor stays above the picker; closing it keeps the picker open */}
    {editing && (
      <SshFormModal open initial={editing} onClose={() => setEditing(null)} />
    )}

    {deleting && (
      <ConfirmDialog
        open
        danger
        title={t('Delete SSH connection?')}
        message={deleting.name}
        confirmLabel={t('Delete')}
        cancelLabel={t('Cancel')}
        onConfirm={() => { const conn = deleting; setDeleting(null); removeConnection(conn); }}
        onCancel={() => setDeleting(null)}
      />
    )}
  </>;
}

function OptionRow({ opt, index, selected, onSelect, onCreate, onContextMenu }: {
  opt: NewTabOption;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const Icon = opt.kind === 'ssh' ? SshIcon : shellIconFor(opt.shellType);
  return (
    <button className="new-tab-row" data-active={selected || undefined}
      onClick={onCreate}
      onMouseEnter={onSelect}
      onContextMenu={onContextMenu}
      data-testid={`new-tab-option-${opt.key}`}
    >
      <Icon size={18} />
      <span><strong>{opt.label}</strong>{opt.subtitle && <small>{opt.subtitle}</small>}</span>
      <KeyHint shortcut={`${isMacOS ? 'Meta' : 'Control'}+${index + 1}`} />
    </button>
  );
}
