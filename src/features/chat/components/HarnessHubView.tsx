/**
 * HarnessHubView — the workspace surface for ACP servers: the launcher, not the settings.
 *
 * Configuration belongs to the ACP settings page (adding, editing, enabling, removing, presets).
 * This surface exists to start a session and to see whether a server can run, so it shows the
 * server, whether its program is on PATH, the connection probe and the two actions that matter —
 * and points at the settings for everything else.
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { OutlineButton } from '@ui/OutlineButton';
import { IconButton } from '@ui/IconButton';
import { RefreshCw } from '@ui/icons';
import HarnessBadge from '@features/settings/components/HarnessBadge';
import { useSessionStore } from '@features/workspace';
import { acpHandshake, acpHarnesses, type AgentDescription } from '@platform/api/acp';
import { invoke } from '@platform/diagnostics';

interface HubEntry {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export default function HarnessHubView() {
  const [list, setList] = useState<HubEntry[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const toast = (message: string, tone: 'success' | 'error') => useToastStore.getState().addToast(message, tone);

  const reload = useCallback(() => {
    void acpHarnesses()
      .then((entries) => setList(entries.map((entry) => ({
        name: entry.name, command: entry.command, args: entry.args, enabled: entry.enabled,
      }))))
      .catch(() => setList([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Ask once per command whether the program exists: most presets need something installed.
  useEffect(() => {
    if (!list) return;
    for (const entry of list) {
      const command = entry.command.trim();
      if (!command || command in installed) continue;
      void invoke<boolean>('which_cmd', { cmd: command })
        .then((found) => setInstalled((current) => ({ ...current, [command]: found })))
        .catch(() => setInstalled((current) => ({ ...current, [command]: true })));
    }
  }, [list, installed]);

  const test = async (name: string) => {
    setProbe((current) => ({ ...current, [name]: t('Testing…') }));
    try {
      const agent: AgentDescription = await acpHandshake(name);
      const info = agent.agentInfo;
      setProbe((current) => ({
        ...current,
        [name]: `${info?.title || info?.name || name}${info?.version ? ` ${info.version}` : ''} · ACP v${agent.protocolVersion ?? '?'}`,
      }));
    } catch (error) {
      setProbe((current) => ({ ...current, [name]: String((error as Error)?.message ?? error) }));
      toast(String((error as Error)?.message ?? error), 'error');
    }
  };

  return (
    <div data-testid="harness-hub" className="scroll-region" style={{
      flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 24px',
      background: 'var(--canvas)', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-subtitle)', fontWeight: 'var(--fw-semibold)' }}>
          {t('Harness hub')}
        </strong>
        <span data-tip={t('ACP')}
          data-tip-description={t('A harness is a program you add: adding it is the authorization. Nothing third-party ships with the app.')}
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          · {t('{{count}} configured', { count: list?.length ?? 0 })}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
          <IconButton compact data-testid="harness-reload" aria-label={t('Reload')} data-tip={t('Reload')} onClick={reload}>
            <RefreshCw size={14} />
          </IconButton>
        </span>
      </header>

      {/* One card per server: what it is, whether it can run, and the two actions that matter. */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {list?.map((entry, index) => {
          const missing = installed[entry.command.trim()] === false;
          return (
            <section key={`${entry.name}-${index}`} data-testid={`harness-card-${index}`} className="usage-card"
              style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: entry.enabled ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <HarnessBadge name={entry.name} size={34} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</strong>
                  <span data-tip={t('The command line this harness runs')} style={{
                    color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{entry.command} {entry.args.join(' ')}</span>
                </span>
                <span data-testid={`harness-status-${index}`} style={{
                  color: missing ? 'var(--error)' : entry.enabled ? 'var(--success)' : 'var(--text-muted)',
                  fontSize: 'var(--fs-micro)', flexShrink: 0,
                }}>
                  {missing ? t('Not installed on PATH') : entry.enabled ? t('Ready') : t('Disabled')}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <button data-testid={`harness-connect-${index}`} disabled={!entry.enabled}
                  onClick={() => useSessionStore.getState().openHarnessTab(entry.name)} style={{
                    padding: '6px 14px', border: 0, borderRadius: 'var(--radius-inner)', cursor: entry.enabled ? 'pointer' : 'default',
                    background: entry.enabled ? 'var(--primary-button-bg)' : 'var(--hover)',
                    color: entry.enabled ? 'var(--primary-button-text)' : 'var(--text-muted)',
                    font: `${'var(--fs-caption)'} var(--font-ui)`,
                  }}>{t('Connect')}</button>
                <OutlineButton data-testid={`harness-test-${index}`} onClick={() => void test(entry.name)}>{t('Test connection')}</OutlineButton>
              </div>
              {probe[entry.name] && (
                <span data-testid={`harness-probe-${index}`} style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)', wordBreak: 'break-word' }}>
                  {probe[entry.name]}
                </span>
              )}
            </section>
          );
        })}
        {list?.length === 0 && (
          <span data-testid="harness-none" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            {t('No harness configured yet. Start from a preset below.')}
          </span>
        )}
      </div>

      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
        {t('Servers are added, edited and enabled on the ACP settings page; this surface only starts and probes them.')}
      </span>
    </div>
  );
}
