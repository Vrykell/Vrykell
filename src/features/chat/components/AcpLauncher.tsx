/**
 * AcpLauncher — the floating panel behind the sidebar's ACP button.
 *
 * One row per configured server (the agent's own mark, the name, the command line and whether the
 * program is on PATH); picking one opens its session tab. Configuration belongs to the ACP settings
 * page, so this panel only starts what is already configured.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { IconButton } from '@ui/IconButton';
import { X } from '@ui/icons';
import { useDialogKeyboard } from '@ui/useDialogKeyboard';
import HarnessBadge from '@features/settings/components/HarnessBadge';
import { useSessionStore } from '@features/workspace';
import { acpHarnesses } from '@platform/api/acp';
import { invoke } from '@platform/diagnostics';

interface LauncherEntry {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export default function AcpLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<LauncherEntry[] | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const dialog = useRef<HTMLDivElement>(null);
  useDialogKeyboard(dialog, open, { onClose });

  useEffect(() => {
    if (!open) return;
    void acpHarnesses()
      .then((entries) => setList(entries.map((entry) => ({
        name: entry.name, command: entry.command, args: entry.args, enabled: entry.enabled,
      }))))
      .catch(() => setList([]));
  }, [open]);

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

  if (!open) return null;

  return (
    <div
      data-testid="acp-launcher"
      style={{
        position: 'fixed', inset: 0, zIndex: 9997,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--overlay)', animation: 'overlayIn 0.18s var(--ease)',
      }}
      onClick={onClose}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className="workspace-floating workspace-floating-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('ACP')}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 440, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          padding: 14, display: 'flex', flexDirection: 'column', gap: 4,
          animation: 'modalIn 0.22s var(--ease-out)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 'calc(13px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)' }}>
            {t('ACP')}
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <IconButton compact data-testid="acp-launcher-close" aria-label={t('Close')} data-tip={t('Close')} onClick={onClose}>
              <X size={14} />
            </IconButton>
          </span>
        </div>
        {list?.length === 0 && (
          <span data-testid="acp-launcher-none" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            {t('No harness configured yet. Start from a preset below.')}
          </span>
        )}
        {list?.map((entry) => {
          const missing = installed[entry.command.trim()] === false;
          return (
            <button
              key={entry.name}
              type="button"
              className="acp-row"
              data-testid={`acp-launcher-${entry.name}`}
              disabled={!entry.enabled || missing}
              onClick={() => {
                useSessionStore.getState().openHarnessTab(entry.name);
                onClose();
              }}
            >
              <HarnessBadge name={entry.name} size={26} />
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{
                  display: 'block', color: 'var(--text-primary)', fontWeight: 'var(--fw-semibold)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {entry.name}
                </span>
                <span style={{
                  display: 'block', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {entry.command} {entry.args.join(' ')}
                </span>
              </span>
              <span style={{
                color: missing ? 'var(--error)' : entry.enabled ? 'var(--success)' : 'var(--text-muted)',
                fontSize: 'var(--fs-micro)', flexShrink: 0,
              }}>
                {missing ? t('Not installed on PATH') : entry.enabled ? t('Ready') : t('Disabled')}
              </span>
            </button>
          );
        })}
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', marginTop: 6 }}>
          {t('Servers are added, edited and enabled on the ACP settings page; this surface only starts and probes them.')}
        </span>
      </div>
    </div>
  );
}
