/**
 * HarnessHubView — the workspace surface for external harnesses: the entry, not the settings.
 *
 * The pattern comes from the tools that do this well: the reference desktop client keeps the choice
 * of agent in the sidebar and the reference switcher keeps its apps in a chip row, so the entry is a
 * set of things you can see side by side. Editing still happens here (the list owns the config and
 * saves as it is edited), rather than in a settings form nobody opens again.
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { Field, inputStyle } from '@features/settings/components/ui';
import { OutlineButton } from '@ui/OutlineButton';
import HarnessBadge from '@features/settings/components/HarnessBadge';
import { useSessionStore } from '@features/workspace';
import { acpHandshake, acpHarnessSave, acpHarnesses, type AgentDescription } from '@platform/api/acp';
import { HARNESS_PRESETS, harnessProblems, upsertPreset, type HarnessEntry } from '@config/harnessPresets';
import { invoke } from '@platform/diagnostics';

export default function HarnessHubView() {
  const [list, setList] = useState<HarnessEntry[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  /** Which harness the chip row is narrowed to; empty means all of them. */
  const [selected, setSelected] = useState(ALL);
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

  // A row that exists on screen has to exist in the file, because the buttons beside it read it. A
  // row that cannot run is shown as a problem and never written down.
  useEffect(() => {
    if (!touched || !list) return;
    const found = harnessProblems(list);
    setProblems(found);
    if (found.length > 0) return;
    const timer = window.setTimeout(() => {
      void acpHarnessSave(list).catch((error) => toast(String((error as Error)?.message ?? error), 'error'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [list, touched]);

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
    }
  };

  /** A connect click must not race the debounced save: the harness has to be on disk before it runs. */
  const connect = async (name: string) => {
    if (touched && list && harnessProblems(list).length === 0) {
      try {
        await acpHarnessSave(list);
      } catch (error) {
        toast(String((error as Error)?.message ?? error), 'error');
        return;
      }
    }
    useSessionStore.getState().openHarnessTab(name);
  };

  const visible = (list ?? []).map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => selected === ALL || entry.name === selected);

  return (
    <div data-testid="harness-hub" className="scroll-region" style={{
      flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 24px',
      background: 'var(--canvas)', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-subtitle)', fontWeight: 'var(--fw-semibold)' }}>
          {t('Harness hub')}
        </strong>
        <span data-tip={t('External harnesses')}
          data-tip-description={t('A harness is a program you add: adding it is the authorization. Nothing third-party ships with the app.')}
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          · {t('{{count}} configured', { count: list?.length ?? 0 })}
        </span>
      </header>

      {/* Chip row: 全部 plus one chip per harness, the reference switcher's shape. */}
      <div role="group" aria-label={t('Harness filter')} style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: 3, height: 36,
        borderRadius: 'var(--radius-inner)', background: 'var(--hover)', alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto',
      }}>
        <button type="button" data-subtle data-testid="harness-chip-all" aria-pressed={selected === ALL}
          onClick={() => setSelected(ALL)} className="usage-source-chip">{t('All')}</button>
        {(list ?? []).map((entry) => (
          <button key={entry.name} type="button" data-subtle data-testid={`harness-chip-${entry.name}`}
            aria-label={entry.name} aria-pressed={selected === entry.name} data-tip={entry.name}
            onClick={() => setSelected(selected === entry.name ? ALL : entry.name)} className="usage-source-chip">
            <HarnessBadge name={entry.name} size={18} />
            <span style={{ whiteSpace: 'nowrap' }}>{entry.name}</span>
          </button>
        ))}
      </div>

      {problems.length > 0 && (
        <span data-testid="harness-problems" style={{ color: 'var(--error)', fontSize: 'var(--fs-caption)' }}>{problems.join(' · ')}</span>
      )}

      {/* Cards: what exists, whether it can run, and the two actions that matter. */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {visible.map(({ entry, index }) => {
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
                  color: missing ? 'var(--warning, var(--error))' : 'var(--success)', fontSize: 'var(--fs-micro)', flexShrink: 0,
                }}>
                  {missing ? t('Not installed on PATH') : t('Ready')}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <button data-testid={`harness-connect-${index}`} disabled={!entry.enabled}
                  onClick={() => { void connect(entry.name); }} style={{
                    padding: '6px 14px', border: 0, borderRadius: 'var(--radius-inner)', cursor: entry.enabled ? 'pointer' : 'default',
                    background: entry.enabled ? 'var(--accent)' : 'var(--hover)', color: entry.enabled ? 'var(--canvas)' : 'var(--text-muted)',
                    font: `${'var(--fs-caption)'} var(--font-ui)`,
                  }}>{t('Connect')}</button>
                <OutlineButton data-testid={`harness-test-${index}`} onClick={() => void test(entry.name)}>{t('Test connection')}</OutlineButton>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>
                  <input type="checkbox" checked={entry.enabled} aria-label={t('Enabled')} onChange={(event) => patch(index, { enabled: event.target.checked })} />
                  {t('Enabled')}
                </label>
              </div>
              {probe[entry.name] && <span data-testid={`harness-probe-${index}`} style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)' }}>{probe[entry.name]}</span>}
              <details>
                <summary style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}>{t('Command and arguments')}</summary>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <input aria-label={t('Command')} value={entry.command} style={{ ...inputStyle, width: 140 }}
                    onChange={(event) => patch(index, { command: event.target.value })} />
                  <input aria-label={t('Arguments')} value={entry.args.join(' ')} style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                    placeholder={t('Arguments, separated by spaces')}
                    onChange={(event) => patch(index, { args: event.target.value.split(/\s+/).filter(Boolean) })} />
                  <OutlineButton data-testid={`harness-remove-${index}`}
                    onClick={() => { setTouched(true); setList((current) => current?.filter((_entry, at) => at !== index) ?? current); }}>{t('Remove')}</OutlineButton>
                </div>
              </details>
            </section>
          );
        })}
        {list?.length === 0 && (
          <Field layout="stacked" title={t('No harness configured yet. Start from a preset below.')}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
              {t('A harness is a program you add: adding it is the authorization. Nothing third-party ships with the app.')}
            </span>
          </Field>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-label)' }}>{t('Presets')}</span>
        <div data-testid="harness-presets" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {HARNESS_PRESETS.map((preset) => (
            <OutlineButton key={preset.name} data-testid={`harness-preset-${preset.name}`}
              data-tip={`${preset.command} ${preset.args.join(' ')}`} data-tip-description={preset.hint}
              onClick={() => { setTouched(true); setList((current) => upsertPreset(current ?? [], preset)); }}>
              <HarnessBadge name={preset.name} size={18} /> {preset.name}
            </OutlineButton>
          ))}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
          {t('A harness marked "not installed" needs its program on PATH (or its command line fixed) before it can run.')}
        </span>
      </div>
    </div>
  );
}

/** Chip value meaning "no filter". */
const ALL = '';
