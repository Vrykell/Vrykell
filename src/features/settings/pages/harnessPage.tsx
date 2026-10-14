/**
 * HarnessPage — the settings section for external harnesses.
 *
 * The list is read from `~/.vrykell/harnesses.json` (the file stays hand-editable), and the two
 * actions are "test connection" (a handshake that runs no tools) and "connect" (opens the workspace
 * page). The copy says what matters: a harness is a program the user adds, and adding it is the
 * authorization.
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@i18n';
import { SettingsGroup, Field, btnStyle } from '@features/settings/components/ui';
import { useSessionStore } from '@features/workspace';
import { acpHandshake, acpHarnesses, type AgentDescription, type HarnessConfig } from '@platform/api/acp';

export default function HarnessPage() {
  const [harnesses, setHarnesses] = useState<HarnessConfig[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});

  const reload = useCallback(() => {
    void acpHarnesses().then(setHarnesses).catch(() => setHarnesses([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);

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
    }
  };

  return (
    <SettingsGroup title={t('External harnesses')}>
      <Field layout="stacked" title={t('Configured harnesses')}
        description={t('A harness is a program you add to the list. Adding it is the authorization: it runs with your account, like a command typed into the terminal.')}>
        {harnesses === null && <span style={{ color: 'var(--text-muted)' }}>{t('Loading…')}</span>}
        {harnesses?.length === 0 && (
          <span data-testid="harness-none" style={{ color: 'var(--text-muted)' }}>
            {t('No harness configured. Add one to ~/.vrykell/harnesses.json.')}
          </span>
        )}
        {!!harnesses?.length && (
          <div className="settings-option-list">
            {harnesses.map((harness) => (
              <div key={harness.name} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)' }}>{harness.name}</strong>
                    <span data-tip={t('The command line this harness runs')} style={{
                      display: 'block', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {harness.command} {harness.args.join(' ')}
                    </span>
                  </span>
                  {!harness.enabled && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>{t('This harness is disabled.')}</span>}
                  <button style={btnStyle} data-testid={`harness-test-${harness.name}`} onClick={() => void test(harness.name)}>
                    {t('Test connection')}
                  </button>
                  <button style={btnStyle} data-testid={`harness-connect-${harness.name}`} disabled={!harness.enabled}
                    onClick={() => useSessionStore.getState().openHarnessTab(harness.name)}>
                    {t('Connect')}
                  </button>
                </div>
                {probe[harness.name] && <span data-testid={`harness-probe-${harness.name}`} style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
                  {probe[harness.name]}
                </span>}
              </div>
            ))}
          </div>
        )}
        <button style={btnStyle} onClick={reload}>{t('Reload the list')}</button>
      </Field>
      <Field title={t('Approvals')}
        description={t('Harness permissions are refused until the approval card is wired to them in the next phase; nothing a harness asks for runs unnoticed.')}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          {t('Refused automatically for now.')}
        </span>
      </Field>
    </SettingsGroup>
  );
}
