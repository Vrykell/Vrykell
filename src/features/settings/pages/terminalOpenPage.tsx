/**
 * terminalOpenPage — per-shell terminal open-mode settings.
 */
import Select from '@ui/Select';
import { useAgentSettings } from '@features/agent';
import { useT } from '@i18n';
import { SHELL_TYPES, shellTypeLabel, type ShellType } from '@platform/shells';
import { Field } from '@features/settings/components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';

/** A row keeps its label on the left and pushes the dropdown to the right edge. */
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8 } as const;
const labelStyle = { flex: 1, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)' } as const;

export function TerminalOpenPage() {
  const { t } = useT();
  const agentSettings = useAgentSettings();
  const openModeByShell = agentSettings.global.openModeByShell;
  const sshOpenMode = agentSettings.global.sshOpenMode;
  const { save } = useSettingsSave();
  const openModeOptions: { value: 'classic' | 'block'; label: string }[] = [
    { value: 'classic', label: t('settings.openMode.classic') },
    { value: 'block', label: t('settings.openMode.block') },
  ];
  const setShellMode = (shell: ShellType, mode: 'classic' | 'block') =>
    save(() => agentSettings.update({ openModeByShell: { ...openModeByShell, [shell]: mode } }));
  const setSshMode = (mode: 'classic' | 'block') =>
    save(() => agentSettings.update({ sshOpenMode: mode }));

  return (
    <>
      <Field title={t('settings.openMode.title')} description={t('settings.openMode.description')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SHELL_TYPES.map((shell) => (
            <div key={shell} style={rowStyle}>
              <span style={labelStyle}>{shellTypeLabel(shell)}</span>
              {shell === 'cmd' && (
                <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>
                  {t('settings.openMode.cmdHint')}
                </span>
              )}
              <Select
                aria-label={t('settings.openMode.aria', { shell: shellTypeLabel(shell) })}
                options={shell === 'cmd' ? openModeOptions.filter(option => option.value === 'classic') : openModeOptions}
                value={shell === 'cmd' ? 'classic' : openModeByShell[shell]}
                onChange={(v) => setShellMode(shell, v)}
              />
            </div>
          ))}
          <div style={rowStyle}>
            <span style={labelStyle}>SSH</span>
            <Select
              aria-label={t('settings.openMode.sshAria')}
              options={openModeOptions}
              value={sshOpenMode}
              onChange={setSshMode}
            />
          </div>
        </div>
      </Field>
    </>
  );
}
