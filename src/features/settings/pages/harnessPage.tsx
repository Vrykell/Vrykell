/**
 * HarnessPage — the settings section for external harnesses.
 *
 * The list is editable here and written back to `~/.vrykell/harnesses.json` (which stays
 * hand-editable), and the built-in presets fill in a command line so nobody has to look it up. The
 * copy says what matters: a harness is a program the user adds, adding it is the authorization, and
 * no third-party program ships with the app.
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { SettingsGroup, Field, inputStyle, btnStyle } from '@features/settings/components/ui';
import HarnessBadge from '@features/settings/components/HarnessBadge';
import { invoke } from '@platform/diagnostics';
import { useSessionStore } from '@features/workspace';
import { acpHandshake, acpHarnessSave, acpHarnesses, type AgentDescription } from '@platform/api/acp';
import { HARNESS_PRESETS, harnessProblems, upsertPreset, type HarnessEntry } from '@config/harnessPresets';

export default function HarnessPage() {
  const [list, setList] = useState<HarnessEntry[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** Set once the user changes anything, so the auto-save never writes the freshly loaded list. */
  const [touched, setTouched] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  /** command → whether the program exists on this machine. */
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const toast = (message: string, tone: 'success' | 'error') => useToastStore.getState().addToast(message, tone);

  const reload = useCallback(() => {
    void acpHarnesses()
      .then((entries) => setList(entries.map((entry) => ({
        name: entry.name, command: entry.command, args: entry.args, env: entry.env, cwd: entry.cwd, enabled: entry.enabled,
      }))))
      .catch(() => setList([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const patch = (index: number, update: Partial<HarnessEntry>) => {
    setTouched(true);
    setList((current) => current?.map((entry, at) => (at === index ? { ...entry, ...update } : entry)) ?? current);
  };

  // Auto-save: a row that exists on screen has to exist in the file, because the buttons beside it
  // (test connection, connect) read the file. A broken row is never written down.
  useEffect(() => {
    if (!touched || !list) return;
    const problems = harnessProblems(list);
    setProblems(problems);
    if (problems.length > 0) return;
    const timer = window.setTimeout(() => {
      void acpHarnessSave(list).catch((error) => toast(String((error as Error)?.message ?? error), 'error'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [list, touched]);

  // Ask once per command whether the program exists, so a preset that cannot run says so before the
  // user presses anything: most presets need a program the machine may not have.
  useEffect(() => {
    if (!list) return;
    for (const entry of list) {
      const command = entry.command.trim();
      if (!command || command in installed) continue;
      void invoke<boolean>('which_cmd', { cmd: command })
        .then((found) => setInstalled((current) => ({ ...current, [command]: found })))
        // Unknown is not the same as missing: a failed probe must not accuse the user's machine.
        .catch(() => setInstalled((current) => ({ ...current, [command]: true })));
    }
  }, [list, installed]);

  const save = async () => {
    if (!list) return;
    const problems = harnessProblems(list);
    if (problems.length > 0) {
      toast(t('Fix the highlighted harnesses first: {{problems}}', { problems: problems.join('; ') }), 'error');
      return;
    }
    setBusy(true);
    try {
      await acpHarnessSave(list);
      toast(t('Harness list saved.'), 'success');
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    } finally {
      setBusy(false);
    }
  };

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
        description={t('A harness is a program you add to the list. Adding it is the authorization: it runs with your account, like a command typed into the terminal. Third-party programs are not bundled — install them yourself and follow their licences.')}>
        {list === null && <span style={{ color: 'var(--text-muted)' }}>{t('Loading…')}</span>}
        <button type="button" data-testid="harness-open-hub"
          onClick={() => useSessionStore.getState().openHarnessHubTab()}
          style={{
            alignSelf: 'flex-start', padding: '6px 14px', border: 0, borderRadius: 'var(--radius-inner)',
            background: 'var(--accent)', color: 'var(--canvas)', cursor: 'pointer',
            font: `${'var(--fs-caption)'} var(--font-ui)`,
          }}>
          {t('Open the harness hub')}
        </button>
        {problems.length > 0 && (
          <span data-testid="harness-problems" style={{ color: 'var(--error)' }}>{problems.join(' · ')}</span>
        )}
        {list?.length === 0 && (
          <span data-testid="harness-none" style={{ color: 'var(--text-muted)' }}>
            {t('No harness configured yet. Start from a preset below.')}
          </span>
        )}
        <div className="settings-option-list">
          {list?.map((harness, index) => (
            <div key={`${harness.name}-${index}`} data-testid={`harness-row-${index}`} style={{
              display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', marginTop: 8,
              border: '1px solid var(--border)', borderRadius: 16,
              background: harness.enabled ? 'var(--surface)' : 'var(--hover)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <HarnessBadge name={harness.name} size={32} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <input aria-label={t('Harness name')} value={harness.name}
                      style={{ ...inputStyle, width: 150, fontWeight: 'var(--fw-semibold)' }}
                      onChange={(event) => patch(index, { name: event.target.value })} />
                    {installed[harness.command.trim()] === false && (
                      <span data-testid={`harness-missing-${index}`} style={{
                        color: 'var(--warning, var(--text-muted))', fontSize: 'var(--fs-micro)',
                        padding: '1px 6px', borderRadius: 4, background: 'var(--hover)',
                      }}>
                        {t('Not installed on PATH')}
                      </span>
                    )}
                  </span>
                  <span data-tip={t('The command line this harness runs')} style={{
                    color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {harness.command} {harness.args.join(' ')}
                  </span>
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
                  <input type="checkbox" checked={harness.enabled} aria-label={t('Enabled')}
                    onChange={(event) => patch(index, { enabled: event.target.checked })} />
                  {t('Enabled')}
                </label>
                <button data-subtle data-testid={`harness-connect-${index}`} disabled={!harness.enabled}
                  onClick={() => useSessionStore.getState().openHarnessTab(harness.name)} style={{
                    padding: '5px 12px', border: 0, borderRadius: 'var(--radius-inner)', cursor: harness.enabled ? 'pointer' : 'default',
                    background: harness.enabled ? 'var(--accent)' : 'var(--hover)', color: harness.enabled ? 'var(--canvas)' : 'var(--text-muted)',
                    font: `${'var(--fs-caption)'} var(--font-ui)`,
                  }}>{t('Connect')}</button>
                <button style={btnStyle} data-testid={`harness-test-${index}`} onClick={() => void test(harness.name)}>{t('Test connection')}</button>
              </div>
              <details>
                <summary style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}>{t('Command and arguments')}</summary>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <input aria-label={t('Command')} value={harness.command} style={{ ...inputStyle, width: 150 }}
                    onChange={(event) => patch(index, { command: event.target.value })} />
                  <input aria-label={t('Arguments')} value={harness.args.join(' ')} style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                    placeholder={t('Arguments, separated by spaces')}
                    onChange={(event) => patch(index, { args: event.target.value.split(/\s+/).filter(Boolean) })} />
                  <button style={btnStyle} data-testid={`harness-remove-${index}`}
                    onClick={() => { setTouched(true); setList((current) => current?.filter((_entry, at) => at !== index) ?? current); }}>{t('Remove')}</button>
                </div>
              </details>
              {probe[harness.name] && <span data-testid={`harness-probe-${index}`} style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>{probe[harness.name]}</span>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button style={btnStyle} data-testid="harness-add" onClick={() => { setTouched(true); setList((current) => [...(current ?? []), { name: t('New harness'), command: '', args: [], env: {}, cwd: '', enabled: true }]); }}>
            {t('Add an empty row')}
          </button>
          <button style={btnStyle} data-testid="harness-save" disabled={busy} onClick={() => void save()}>{t('Save the list')}</button>
          <button style={btnStyle} onClick={reload}>{t('Reload')}</button>
        </div>
        {list?.some((entry) => installed[entry.command] === false) && (
          <span style={{ color: 'var(--warning, var(--error))', fontSize: 'var(--fs-caption)' }}>
            {t('A harness marked "not installed" needs its program on PATH (or its command line fixed) before it can run.')}
          </span>
        )}
      </Field>

      <Field layout="stacked" title={t('Presets')}
        description={t('Fills in the command line a harness is usually started with. The program itself still has to be installed.')}>
        <div data-testid="harness-presets" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {HARNESS_PRESETS.map((preset) => (
            <button key={preset.name} style={btnStyle} data-testid={`harness-preset-${preset.name}`}
              data-tip={`${preset.command} ${preset.args.join(' ')}`} data-tip-description={preset.hint}
              onClick={() => { setTouched(true); setList((current) => upsertPreset(current ?? [], preset)); }}>
              {preset.name}
            </button>
          ))}
        </div>
      </Field>

      <Field title={t('Approvals')}
        description={t('When a harness asks to run something, the request appears as a card in its conversation and waits for your answer; nothing a harness asks for runs unnoticed.')}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>{t('An unanswered card is refused after ten minutes.')}</span>
      </Field>
    </SettingsGroup>
  );
}
