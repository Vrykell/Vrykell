/**
 * AcpLauncher — the server picker embedded in the workspace or opened to add a connection.
 *
 * Shaped like the new-tab panel: a title, a search field and a flat list of servers (the agent's
 * own mark, the name, the command line and whether the program is on PATH). Picking one opens its
 * internal session tab; configuration lives on the ACP settings page, so this panel only starts what is
 * already configured.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@i18n';
import { iconSizes, Search } from '@ui/icons';
import { TextInput } from '@ui/TextInput';
import { OutlineButton } from '@ui/OutlineButton';
import ErrorBox from '@ui/ErrorBox';
import { useDialogKeyboard } from '@ui/useDialogKeyboard';
import { useSettingsNavigationStore } from '@features/settings/stores/navigation';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useSessionStore } from '@features/workspace';
import { acpHarnesses } from '@platform/api/acp';
import { invoke } from '@platform/diagnostics';

interface LauncherEntry {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export default function AcpLauncher({ open, onClose, embedded = false, onPick }: {
  open: boolean; onClose: () => void; embedded?: boolean; onPick?: (name: string) => void;
}) {
  const [list, setList] = useState<LauncherEntry[] | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useDialogKeyboard(dialogRef, open && !embedded, { onClose, initialFocus: '[data-testid="acp-launcher-search"]' });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError('');
    setList(null);
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    void acpHarnesses()
      .then((entries) => setList(entries.map((entry) => ({
        name: entry.name, command: entry.command, args: entry.args, enabled: entry.enabled,
      }))))
      .catch((error: unknown) => setError(String(error)));
  }, [open, revision]);

  useEffect(() => {
    if (!open || !list) return;
    for (const entry of list) {
      const command = entry.command.trim();
      if (!command || command in installed) continue;
      void invoke<boolean>('which_cmd', { cmd: command })
        .then((found) => setInstalled((current) => ({ ...current, [command]: found })))
        .catch(() => setInstalled((current) => ({ ...current, [command]: true })));
    }
  }, [open, list, installed]);

  const ready = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (list ?? []).filter((entry) => !needle
      || `${entry.name} ${entry.command} ${entry.args.join(' ')}`.toLowerCase().includes(needle));
  }, [list, query]);

  useEffect(() => setSelected(0), [query]);

  const start = (entry: LauncherEntry) => {
    if (onPick) onPick(entry.name);
    else useSessionStore.getState().openHarnessTab(entry.name);
    onClose();
  };

  const handleKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && !embedded) onClose();
    else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, ready.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = ready[selected];
      if (entry && entry.enabled && installed[entry.command.trim()] !== false) start(entry);
    }
  };

  if (!open) return null;

  const content = (
      <div
        ref={dialogRef}
        data-testid="acp-launcher"
        className={embedded ? undefined : 'workspace-floating workspace-floating-dialog'}
        role={embedded ? 'region' : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-label={t('ACP')}
        style={{
          width: embedded ? '100%' : 420, maxWidth: embedded ? undefined : 'calc(100vw - 40px)', maxHeight: embedded ? undefined : '70vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'modalIn 0.22s var(--ease-out)',
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div style={{
          padding: '12px 16px 4px', fontSize: 'calc(13px * var(--ui-font-scale))',
          fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)',
        }}>
          {t('ACP')}
        </div>

        <div style={{ padding: '8px 16px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--field-bg)', borderRadius: 'var(--radius-inner)', padding: '0 8px', height: 28,
          }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <TextInput
              ref={inputRef}
              value={query}
              data-testid="acp-launcher-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search servers…')}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 10px' }}>
          {error && <ErrorBox title={t('Could not load servers')} details={error}
            actions={<OutlineButton onClick={() => setRevision(value => value + 1)}>{t('Retry')}</OutlineButton>} />}
          {!list && !error && <span>{t('Loading…')}</span>}
          {list && ready.length === 0 ? (
            <div data-testid="acp-launcher-none" style={{
              padding: 20, textAlign: 'center', color: 'var(--text-muted)',
              fontSize: 'calc(12px * var(--ui-font-scale))',
            }}>
              {t('No matching servers')}
            </div>
          ) : ready.map((entry, index) => {
            const missing = installed[entry.command.trim()] === false;
            const usable = entry.enabled && !missing;
            const Mark = harnessMark(entry.name);
            return (
              <button
                key={entry.name}
                type="button"
                data-testid={`acp-launcher-${entry.name}`}
                disabled={!usable}
                onClick={() => start(entry)}
                onMouseEnter={() => setSelected(index)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', textAlign: 'left', padding: '8px 10px',
                  border: 'none', borderRadius: 'var(--radius-inner)',
                  background: index === selected ? 'var(--hover)' : 'transparent',
                  color: 'var(--text-primary)', cursor: usable ? 'pointer' : 'default',
                  fontSize: 'calc(13px * var(--ui-font-scale))', opacity: entry.enabled ? 1 : 0.6,
                }}
              >
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, borderRadius: 5,
                  color: 'var(--text-secondary)', flexShrink: 0,
                }}>
                  <Mark size={iconSizes.row} />
                </span>
                <span style={{ flex: 1, overflow: 'hidden' }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.name}
                  </span>
                  <span style={{
                    display: 'block', fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {entry.command} {entry.args.join(' ')}
                  </span>
                </span>
                <span style={{
                  color: missing ? 'var(--error)' : entry.enabled ? 'var(--success)' : 'var(--text-muted)',
                  fontSize: 'calc(11px * var(--ui-font-scale))', flexShrink: 0,
                }}>
                  {missing ? t('Not installed on PATH') : entry.enabled ? t('Ready') : t('Disabled')}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: '0 16px 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
          <OutlineButton onClick={() => {
            onClose();
            useSettingsNavigationStore.getState().openField('ai-harness', t('ACP'));
            useSessionStore.getState().openSettings();
          }}>{t('Configure servers')}</OutlineButton>
        </div>
      </div>
  );
  return embedded ? content : <div style={{ position: 'fixed', inset: 0, zIndex: 9996,
    display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--overlay)',
    animation: 'overlayIn 0.18s var(--ease)' }} onClick={onClose}>{content}</div>;
}
