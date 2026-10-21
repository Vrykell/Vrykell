/**
 * HarnessPage — the settings section for ACP servers.
 *
 * The list is editable here and written back to `~/.vrykell/harnesses.json` (which stays
 * hand-editable), and the built-in presets fill in a command line so nobody has to look it up. The
 * copy says what matters: a server is a program the user adds, adding it is the authorization, and
 * no third-party program ships with the app. Rows are flat at rest and carry their actions on the
 * right; the editor and the removal confirmation are centred dialogs.
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { SettingsGroup, Field } from '@features/settings/components/ui';
import { IconButton } from '@ui/IconButton';
import { OutlineButton } from '@ui/OutlineButton';
import ConfirmDialog from '@ui/ConfirmDialog';
import ErrorBox from '@ui/ErrorBox';
import { useSettingsSave } from '../components/SettingsSaveProvider';
import { Minus, Plus, RefreshCw, Settings } from '@ui/icons';
import HarnessBadge from '@features/agent/components/HarnessBadge';
import HarnessDialog from '@features/settings/components/HarnessDialog';
import { invoke } from '@platform/diagnostics';
import { useSessionStore, useUiStore } from '@features/workspace';
import { acpHandshake, acpHarnessSave, acpHarnesses, type AgentDescription } from '@platform/api/acp';
import { HARNESS_PRESETS, harnessProblems, upsertPreset, type HarnessEntry } from '@config/harnessPresets';

export default function HarnessPage() {
  const [list, setList] = useState<HarnessEntry[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { save: saveSettings } = useSettingsSave();
  const [loadError, setLoadError] = useState('');
  const [probeErrors, setProbeErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  /** command → whether the program exists on this machine. */
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  /** null = closed; { index: null } = the add form; { index: n } = that row's editor. */
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const toast = (message: string, tone: 'success' | 'error') => useToastStore.getState().addToast(message, tone);

  const reload = useCallback(() => {
    setLoadError('');
    void acpHarnesses()
      .then((entries) => setList(entries.map((entry) => ({
        name: entry.name, command: entry.command, args: entry.args, env: entry.env, cwd: entry.cwd, enabled: entry.enabled,
      }))))
      .catch((error: unknown) => setLoadError(String(error)));
  }, []);
  useEffect(() => { reload(); }, [reload]);

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

  const persist = async (next: HarnessEntry[]): Promise<boolean> => {
    const problems = harnessProblems(next);
    setProblems(problems);
    if (problems.length > 0) {
      toast(t('Fix the highlighted harnesses first: {{problems}}', { problems: problems.join('; ') }), 'error');
      return false;
    }
    setBusy(true);
    let saved = false;
    try {
      await saveSettings(async () => {
        await acpHarnessSave(next);
        setList(next);
        saved = true;
      });
      return saved;
    } finally {
      setBusy(false);
    }
  };

  const test = async (name: string) => {
    setProbeErrors(current => ({ ...current, [name]: '' }));
    setProbe((current) => ({ ...current, [name]: t('Testing…') }));
    try {
      const agent: AgentDescription = await acpHandshake(name);
      const info = agent.agentInfo;
      setProbe((current) => ({
        ...current,
        [name]: `${info?.title || info?.name || name}${info?.version ? ` ${info.version}` : ''} · ACP v${agent.protocolVersion ?? '?'}`,
      }));
    } catch (error) {
      setProbe(current => ({ ...current, [name]: '' }));
      setProbeErrors(current => ({ ...current, [name]: String(error) }));
    }
  };

  const writeEntry = (entry: HarnessEntry) => {
    const next = [...(list ?? [])];
    if (editing?.index != null) next[editing.index] = entry;
    else next.push(entry);
    return persist(next);
  };

  return (
    <SettingsGroup title={t('ACP')}>
      <Field layout="stacked" title={t('Servers')}
        description={t('A harness is a program you add to the list. Adding it is the authorization: it runs with your account, like a command typed into the terminal. Third-party programs are not bundled — install them yourself and follow their licences.')}>
        {loadError && <ErrorBox title={t('Could not load servers')} details={loadError}
          actions={<OutlineButton onClick={reload}>{t('Retry')}</OutlineButton>} />}
        {list === null && !loadError && <span style={{ color: 'var(--text-muted)' }}>{t('Loading…')}</span>}
        {problems.length > 0 && (
          <ErrorBox compact testId="harness-problems">{problems.join(' · ')}</ErrorBox>
        )}
        {list?.length === 0 && (
          <span data-testid="harness-none" style={{ color: 'var(--text-muted)' }}>
            {t('No harness configured yet. Start from a preset below.')}
          </span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {list?.map((harness, index) => (
            <div key={`${harness.name}-${index}`}>
            <div data-testid={`harness-row-${index}`} className="acp-row">
              <HarnessBadge name={harness.name} size={30} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{
                    fontWeight: 'var(--fw-semibold)', minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    opacity: harness.enabled ? 1 : 0.6,
                  }}>
                    {harness.name}
                  </span>
                  {installed[harness.command.trim()] === false && (
                    <span data-testid={`harness-missing-${index}`} style={{
                      color: 'var(--text-secondary)', fontSize: 'var(--fs-micro)',
                      padding: '1px 6px', borderRadius: 4, background: 'var(--hover)', flexShrink: 0,
                    }}>
                      {t('Not installed on PATH')}
                    </span>
                  )}
                  {probe[harness.name] && (
                    <span data-testid={`harness-probe-${index}`} style={{
                      color: 'var(--text-muted)', fontSize: 'var(--fs-micro)', minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {probe[harness.name]}
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
              <button data-subtle data-testid={`harness-connect-${index}`} disabled={!harness.enabled || busy}
                onClick={() => {
                  // Settings render as a workspace screen over the tabs: leaving it open would hide
                  // the session this button just opened.
                  useUiStore.getState().setSettingsOpen(false);
                  useSessionStore.getState().openHarnessTab(harness.name);
                }} style={{
                  padding: '5px 12px', border: 0, borderRadius: 'var(--radius-inner)', flexShrink: 0,
                  cursor: harness.enabled ? 'pointer' : 'default',
                  background: harness.enabled ? 'var(--primary-button-bg)' : 'transparent',
                  color: harness.enabled ? 'var(--primary-button-text)' : 'var(--text-muted)',
                  font: `${'var(--fs-caption)'} var(--font-ui)`,
                }}>{t('Connect')}</button>
              <IconButton compact data-testid={`harness-test-${index}`}
                aria-label={t('Test connection')} data-tip={t('Test connection')} onClick={() => void test(harness.name)}>
                <RefreshCw size={14} />
              </IconButton>
              <IconButton compact data-testid={`harness-edit-${index}`}
                disabled={busy}
                aria-label={t('Edit server')} data-tip={t('Edit server')} onClick={() => setEditing({ index })}>
                <Settings size={14} />
              </IconButton>
              <IconButton compact tone="danger" data-testid={`harness-remove-${index}`}
                disabled={busy}
                aria-label={t('Remove')} data-tip={t('Remove')} onClick={() => setConfirmRemove(index)}>
                <Minus size={14} />
              </IconButton>
            </div>
            {probeErrors[harness.name] && <ErrorBox title={t('Connection failed')} details={probeErrors[harness.name]}
              actions={<OutlineButton onClick={() => void test(harness.name)}>{t('Retry')}</OutlineButton>} />}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <OutlineButton data-testid="harness-add" disabled={busy || list === null} onClick={() => setEditing({ index: null })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={12} /> {t('Add server')}
          </OutlineButton>
          <span style={{ flex: 1 }} />
          <OutlineButton data-testid="harness-save" disabled={busy || list === null} onClick={() => list && void persist(list)}>{t('Save the list')}</OutlineButton>
          <IconButton compact disabled={busy} aria-label={t('Reload')} data-tip={t('Reload')} onClick={reload}><RefreshCw size={14} /></IconButton>
        </div>
        {list?.some((entry) => installed[entry.command] === false) && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
            {t('A harness marked "not installed" needs its program on PATH (or its command line fixed) before it can run.')}
          </span>
        )}
      </Field>

      <Field layout="stacked" title={t('Presets')}
        description={t('Fills in the command line a harness is usually started with. The program itself still has to be installed.')}>
        <div data-testid="harness-presets" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {HARNESS_PRESETS.map((preset) => (
            <OutlineButton key={preset.name} data-testid={`harness-preset-${preset.name}`}
              disabled={busy || list === null}
              data-tip={`${preset.command} ${preset.args.join(' ')}`} data-tip-description={t(preset.hint)}
              onClick={() => list && void persist(upsertPreset(list, preset))}>
              <HarnessBadge name={preset.name} size={19} /> {preset.name}
            </OutlineButton>
          ))}
        </div>
      </Field>

      <Field title={t('Approvals')}
        description={t('When a harness asks to run something, the request appears as a card in its conversation and waits for your answer; nothing a harness asks for runs unnoticed.')}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>{t('An unanswered card is refused after ten minutes.')}</span>
      </Field>

      <HarnessDialog
        open={editing !== null}
        entry={editing?.index != null ? list?.[editing.index] ?? null : null}
        onClose={() => setEditing(null)}
        onSave={writeEntry}
      />
      <ConfirmDialog
        open={confirmRemove !== null}
        title={t('Remove server')}
        message={confirmRemove !== null
          ? t('Remove {{name}} from the list?', { name: list?.[confirmRemove]?.name ?? '' })
          : ''}
        confirmLabel={t('Remove')}
        cancelLabel={t('Cancel')}
        danger
        onConfirm={() => {
          const at = confirmRemove;
          if (at === null) return;
          if (list) void persist(list.filter((_entry, index) => index !== at)).then(saved => { if (saved) setConfirmRemove(null); });
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </SettingsGroup>
  );
}
