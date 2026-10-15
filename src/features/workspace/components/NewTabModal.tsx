import { preferredShell, useTerminalDefaults } from '@config/terminalDefaults';
import { loadRecentOpen } from '../model/tabTypes';
import { TextInput } from '@ui/TextInput';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { iconSizes, Search } from '@ui/icons';
import { SshIcon, shellIconFor } from '@ui/shellIcons';
import { getAvailableShells, type ShellOption, type ShellType } from '@platform/shells';
import {
  buildNewTabOptions,
  filterNewTabOptions,
  touchRecentOpen,
  type NewTabOption,
} from '@features/workspace/model/tabTypes';
import { useSshStore, ensureSshLoaded } from '@features/ssh';
import { connectionTarget, type SshConnection } from '@features/ssh/services/api';
import { useSessionStore } from '@features/workspace';
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
  const defaultShell = useTerminalDefaults(state => state.shell);
  const openModeByShell = useAgentSettings(state => state.global.openModeByShell);
  const sshOpenMode = useAgentSettings(state => state.global.sshOpenMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const sshConnections = useSshStore((s) => s.connections);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    setMenu(null);
    setEditing(null);
    setDeleting(null);
    ensureSshLoaded();
    let cancelled = false;
    getAvailableShells().then((s) => {
      if (!cancelled) setShells(s);
    });
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelled = true;
    };
  }, [open]);

  const options = useMemo(
    () => buildNewTabOptions(shells, sshConnections, loadRecentOpen(), defaultShell),
    [shells, sshConnections, defaultShell],
  );

  const filtered = useMemo(
    () => filterNewTabOptions(options, query),
    [options, query],
  );

  useEffect(() => setSelected(0), [query]);

  const create = useCallback((opt: NewTabOption) => {
    if (opt.kind === 'shell') {
      touchRecentOpen(opt.key);
      if (onPick) {
        onPick({ id: '', kind: 'local', shellType: opt.shellType });
        onClose();
        return;
      }
      useSessionStore.getState().addTab({ shellType: opt.shellType, groupId });
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
  }, [onClose, groupId, onPick]);

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
      const items: ContextMenuItem[] = [
        {
          label: t('Set as default terminal'),
          checked: shell === preferredShell(defaultShell, shells),
          onClick: () => useTerminalDefaults.getState().setShell(shell),
        },
        {
          label: t('settings.openMode.classic'),
          group: 'view',
          checked: mode === 'classic',
          onClick: () => setShellMode(shell, 'classic'),
        },
      ];
      // CMD is always classic; the settings page hides its block option the same way.
      if (shell !== 'cmd') {
        items.push({
          label: t('settings.openMode.block'),
          group: 'view',
          checked: mode === 'block',
          onClick: () => setShellMode(shell, 'block'),
        });
      }
      return items;
    }
    const conn = state.conn;
    if (!conn) return [];
    return [
      { label: t('Edit connection'), group: 'edit', onClick: () => setEditing(conn) },
      { label: t('settings.openMode.classic'), group: 'view', checked: sshOpenMode === 'classic', onClick: () => setSshMode('classic') },
      { label: t('settings.openMode.block'), group: 'view', checked: sshOpenMode === 'block', onClick: () => setSshMode('block') },
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

  return <>
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9996,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--overlay)',
        animation: 'overlayIn 0.18s var(--ease)',
      }}
      onClick={onClose}
    >
      <div className="workspace-floating workspace-floating-dialog" role="dialog" aria-modal="true" aria-label={t('New tab')}
        style={{
          width: 420, maxWidth: 'calc(100vw - 40px)', maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'modalIn 0.22s var(--ease-out)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div style={{
          padding: '12px 16px 4px', fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)',
          color: 'var(--text-primary)',
        }}>
          {t('New tab')}
        </div>

        {/* Search field */}
        <div style={{ padding: '8px 16px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--field-bg)',
            borderRadius: 'var(--radius-inner)', padding: '0 8px', height: 28,
          }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <TextInput
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search tab types…')}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
              }}
            />
          </div>
        </div>

        {/* Candidate list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 10px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
              {t('No matching tab types')}
            </div>
          ) : filtered.map((o, i) => (
            <OptionRow
              key={o.key}
              opt={o}
              selected={i === selected}
              onSelect={() => setSelected(i)}
              onCreate={() => create(o)}
              onContextMenu={(event) => { setSelected(i); openMenu(event, o); }}
            />
          ))}
        </div>
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

function OptionRow({
  opt,
  selected,
  onSelect,
  onCreate,
  onContextMenu,
}: {
  opt: NewTabOption;
  selected: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const Icon = opt.kind === 'ssh' ? SshIcon : shellIconFor(opt.shellType);
  return (
    <button
      onClick={onCreate}
      onMouseEnter={onSelect}
      onContextMenu={onContextMenu}
      data-testid={`new-tab-option-${opt.key}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', textAlign: 'left', padding: '8px 10px',
        border: 'none', borderRadius: 'var(--radius-inner)',
        background: selected ? 'var(--hover)' : 'transparent',
        color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'calc(13px * var(--ui-font-scale))',
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 5,
        color: 'var(--text-secondary)', flexShrink: 0,
      }}>
        <Icon size={iconSizes.row} />
      </span>
      <span style={{ flex: 1, overflow: 'hidden' }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {opt.label}
        </span>
        {opt.subtitle && (
          <span style={{ display: 'block', fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opt.subtitle}
          </span>
        )}
      </span>
    </button>
  );
}
