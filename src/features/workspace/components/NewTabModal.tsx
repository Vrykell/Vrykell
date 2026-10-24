import { preferredShell, useTerminalDefaults } from '@config/terminalDefaults';
import { useShellProfiles } from '@config/shellProfiles';
import { loadRecentOpen } from '../model/tabTypes';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import AnchoredDropdown from '@ui/menus/AnchoredDropdown';
import { iconSizes, Check, ChevronRight, Columns2, FolderOpen, Settings, PanelLeft } from '@ui/icons';
import { useSettingsNavigationStore } from '@features/settings';
import HomeMark from '~icons/mdi/home-outline';
import FolderPlusMark from '~icons/mdi/folder-plus-outline';
import { openAppWindow } from '@platform/appWindows';
import KeyHint from '@ui/feedback/KeyHint';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import { getAvailableShells, type ShellOption, type ShellType } from '@platform/shells';
import { pickPath } from '@platform/api/fs';
import { isMacOS } from '@platform/runtime';
import {
  buildNewTabOptions,
  touchRecentOpen,
  type NewTabOption,
} from '@features/workspace/model/tabTypes';
import { useSshStore, ensureSshLoaded } from '@features/ssh';
import { connectionTarget, type SshConnection } from '@features/ssh/services/api';
import { getFocusedCwd, useSessionStore, useUiStore } from '@features/workspace';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';
import { useAgentSettings } from '@features/agent';
import { useHostEditor } from '@features/ssh';
import ContextMenu, { type ContextMenuItem } from '@ui/menus/ContextMenu';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';

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
 * Available shells and saved connections share a profile picker and quick settings.
 */
export default function NewTabModal({ open, onClose, groupId, onPick }: Props) {
  const [selected, setSelected] = useState(0);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [deleting, setDeleting] = useState<SshConnection | null>(null);
  const [location, setLocation] = useState<'profile' | 'current' | 'home' | 'custom'>('profile');
  const [customCwd, setCustomCwd] = useState('');
  const defaultShell = useTerminalDefaults(state => state.shell);
  const profiles = useShellProfiles(state => state.profiles);
  const openModeByShell = useAgentSettings(state => state.global.openModeByShell);
  const sshOpenMode = useAgentSettings(state => state.global.sshOpenMode);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sshConnections = useSshStore((s) => s.connections);


  useEffect(() => {
    if (!open) return;
    setSelected(0);
    setKeyboardNavigation(false);
    setMenu(null);
    setDeleting(null);
    setLocation('profile');
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

  const allOptions = useMemo(
    () => buildNewTabOptions(shells, sshConnections, loadRecentOpen(), defaultShell)
      .map(option => option.kind === 'shell' && profiles[option.shellType]?.name ? { ...option, label: profiles[option.shellType]!.name } : option),
    [shells, sshConnections, defaultShell, profiles],
  );
  const options = useMemo(() => allOptions.filter(option => option.kind !== 'shell' || !profiles[option.shellType]?.hidden), [allOptions, profiles]);

  useEffect(() => {
    if (open && keyboardNavigation) dialogRef.current?.querySelector<HTMLElement>('[data-keyboard-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, keyboardNavigation, selected]);

  const targetCwd = location === 'current' ? getFocusedCwd() : location === 'custom' ? customCwd || undefined : undefined;
  const defaultOption = useMemo(() => {
    const preferred = preferredShell(defaultShell, shells);
    return allOptions.find(option => option.kind === 'shell' && option.shellType === preferred)
      ?? allOptions.find(option => option.kind === 'shell');
  }, [allOptions, shells, defaultShell]);

  const create = useCallback((opt: NewTabOption) => {
    if (opt.kind === 'shell') {
      touchRecentOpen(opt.key);
      if (onPick) {
        onPick({ id: '', kind: 'local', shellType: opt.shellType, cwd: targetCwd ?? (location === 'profile' ? profiles[opt.shellType]?.cwd || undefined : undefined), useProfileDirectory: location === 'profile' });
        onClose();
        return;
      }
      useSessionStore.getState().addTab({ shellType: opt.shellType, groupId, cwd: targetCwd, useProfileDirectory: location === 'profile' });
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
  }, [onClose, groupId, onPick, targetCwd, location, profiles]);

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
      { label: t('Edit connection'), group: 'edit', onClick: () => { onClose(); useHostEditor.getState().open(conn); selectWorkspaceArea('ssh'); } },
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

  const openWindow = useCallback(() => {
    openAppWindow(); onClose();
  }, [onClose]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.target !== dialogRef.current && !(e.ctrlKey || e.metaKey)) return;
    if ((isMacOS ? e.metaKey : e.ctrlKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const index = Number(key) - 1;
      if (!e.shiftKey && index >= 0 && index < 9 && options[index]) {
        e.preventDefault(); e.stopPropagation(); create(options[index]); return;
      }
      if (!e.shiftKey && key === 't' && defaultOption) {
        e.preventDefault(); e.stopPropagation(); create(defaultOption); return;
      }
      if (!e.shiftKey && key === 'n' && !onPick) {
        e.preventDefault(); e.stopPropagation(); openWindow(); return;
      }
      if (e.shiftKey && ['t', 'h', 'o'].includes(key)) {
        e.preventDefault(); e.stopPropagation();
        if (key === 'o') void chooseDirectory();
        else setLocation(key === 't' ? 'current' : 'home');
        return;
      }
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setKeyboardNavigation(true); setSelected((s) => Math.min(s + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setKeyboardNavigation(true); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = options[selected]; if (o) create(o); }
  }, [options, selected, create, onClose, defaultOption, chooseDirectory, onPick, openWindow]);

  if (!open) return null;

  return createPortal(<><AnchoredDropdown open={open} onClose={onClose} panelRef={dialogRef} above={!!onPick} aria-label={t('New tab')}
        data-keyboard-navigation={keyboardNavigation} onPointerMove={() => setKeyboardNavigation(false)}
        onKeyDown={handleKey}>
        <section className="new-tab-section" aria-labelledby="new-tab-profiles">
          <h2 id="new-tab-profiles">{t('Choose a profile')}</h2>
          <div className="new-tab-option-list">
            {options.map((option, index) => <OptionRow key={option.key} opt={option} index={index}
              selected={keyboardNavigation && index === selected} isDefault={option.key === defaultOption?.key} onSelect={() => { setSelected(index); setKeyboardNavigation(false); }} onCreate={() => create(option)}
              onContextMenu={event => { setSelected(index); openMenu(event, option); }} />)}
          </div>
          {!options.length && <div className="new-tab-empty">{t('No matching tab types')}</div>}
          <button type="button" className="new-tab-row workspace-floating-row" onClick={() => {
            onClose(); useSettingsNavigationStore.getState().setSelected(`profile:${preferredShell(defaultShell, shells) ?? 'powershell'}`); useSessionStore.getState().openSettings();
          }}><Settings size={20} /><span>{t('More profiles…')}</span><ChevronRight size={16} /></button>
        </section>

        <section className="new-tab-section" aria-labelledby="new-tab-location">
          <h2 id="new-tab-location">{t('Open location')}</h2>
          <button type="button" className="new-tab-row workspace-floating-row" data-active={location === 'current' || undefined}
            onClick={() => setLocation('current')}><FolderOpen size={20} /><span>{t('Open in current directory')}</span>
            <KeyHint shortcut={isMacOS ? 'Meta+Shift+T' : 'Control+Shift+T'} /></button>
          <button type="button" className="new-tab-row workspace-floating-row" data-active={location === 'home' || undefined}
            onClick={() => setLocation('home')}><HomeMark width={20} height={20} /><span>{t('Open in home directory')}</span>
            <KeyHint shortcut={isMacOS ? 'Meta+Shift+H' : 'Control+Shift+H'} /></button>
          <button type="button" className="new-tab-row workspace-floating-row" data-active={location === 'custom' || undefined}
            onClick={() => void chooseDirectory()}><FolderPlusMark width={20} height={20} /><span>{customCwd || t('Choose a directory…')}</span>
            <KeyHint shortcut={isMacOS ? 'Meta+Shift+O' : 'Control+Shift+O'} /></button>
        </section>

        <section className="new-tab-section" aria-labelledby="new-tab-advanced">
          <h2 id="new-tab-advanced">{t('Advanced')}</h2>
          {!onPick && <button type="button" className="new-tab-row workspace-floating-row" onClick={openWindow}>
            <PanelLeft size={20} /><span>{t('Open in new window')}</span><KeyHint shortcut={isMacOS ? 'Meta+N' : 'Control+N'} /></button>}
          <button type="button" className="new-tab-row workspace-floating-row" onClick={() => {
            onClose(); useUiStore.getState().beginSplit(null);
          }}><Columns2 size={18} /><span>{t('Split tab')}</span><ChevronRight size={16} /></button>
        </section>
    </AnchoredDropdown>

    {/* Row quick settings */}
    {menu && menuItems.length > 0 && (
      <ContextMenu anchor={{ x: menu.x, y: menu.y }} items={menuItems} onClose={() => setMenu(null)} />
    )}
    {/* Connection editor stays above the picker; closing it keeps the picker open */}

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
  </>, document.body);
}

function OptionRow({ opt, index, selected, isDefault, onSelect, onCreate, onContextMenu }: {
  opt: NewTabOption;
  index: number;
  selected: boolean;
  isDefault: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  return (
    <button type="button" className="new-tab-row workspace-floating-row" data-keyboard-active={selected || undefined}
      onClick={onCreate}
      onMouseEnter={onSelect}
      onContextMenu={onContextMenu}
      data-testid={`new-tab-option-${opt.key}`}
    >
      <TerminalProfileIcon kind={opt.kind === 'ssh' ? 'ssh' : 'local'} shellType={opt.kind === 'shell' ? opt.shellType : undefined}
        connectionId={opt.kind === 'ssh' ? opt.sshId : undefined} size={iconSizes.row} />
      <span data-tip={opt.subtitle}><strong>{opt.label}</strong></span>
      {isDefault ? <Check size={18} aria-label={t('Default terminal')} />
        : index < 9 && <KeyHint shortcut={`${isMacOS ? 'Meta' : 'Control'}+${index + 1}`} />}
    </button>
  );
}
