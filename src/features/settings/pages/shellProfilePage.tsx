import { t } from '@i18n';
import { shellTypeLabel, type ShellType } from '@platform/shells';
import { pickPath } from '@platform/api/fs';
import { EMPTY_SHELL_PROFILE, useShellProfiles } from '@config/shellProfiles';
import { useTerminalDefaults } from '@config/terminalDefaults';
import { useAgentSettings } from '@features/agent';
import SegmentedControl from '@ui/fields/SegmentedControl';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { Field, SettingsGroup, Toggle } from '../components/ui';
import AutoSaveInput from '../components/AutoSaveInput';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export default function ShellProfilePage({ shell }: { shell: ShellType }) {
  const profile = useShellProfiles(state => state.profiles[shell] ?? EMPTY_SHELL_PROFILE);
  const update = useShellProfiles(state => state.update);
  const defaultShell = useTerminalDefaults(state => state.shell);
  const mode = useAgentSettings(state => state.global.openModeByShell[shell]);
  const modeOptions = [{ value: 'classic', label: t('settings.openMode.classic') }, { value: 'block', label: t('settings.openMode.block') }] as const;
  const { save } = useSettingsSave();
  const set = (patch: Partial<typeof profile>) => save(() => update(shell, patch));
  return <div className="shell-profile-page">
    <SettingsGroup title={t('Profile identity')}>
      <Field title={t('Profile name')}><AutoSaveInput aria-label={t('Profile name')} value={profile.name} placeholder={shellTypeLabel(shell)} onCommit={value => update(shell, { name: value })} /></Field>
      <Field title={t('Tab title')} description={t('Leave empty to use the shell title.')}><AutoSaveInput aria-label={t('Tab title')} value={profile.tabTitle} onCommit={value => update(shell, { tabTitle: value })} /></Field>
    </SettingsGroup>
    <SettingsGroup title={t('Startup')}>
      <Field layout="stacked" title={t('Starting directory')} description={t('Applies to new terminals. An explicitly chosen directory takes priority.')}>
        <div className="shell-profile-directory"><AutoSaveInput style={{ flex: 1, minWidth: 0 }} aria-label={t('Starting directory')} value={profile.cwd} placeholder={t('Inherit current directory')} onCommit={value => update(shell, { cwd: value })} />
        <OutlineButton onClick={() => save(async () => { const [path] = await pickPath('directory'); if (path) update(shell, { cwd: path }); })}>{t('Browse…')}</OutlineButton></div>
      </Field>
      <Field title={t('Opening mode')}>
        <SegmentedControl label={t('Opening mode')} value={shell === 'cmd' ? 'classic' : mode}
          options={shell === 'cmd' ? modeOptions.slice(0, 1) : modeOptions}
          onChange={value => { void save(() => { const store = useAgentSettings.getState(); store.update({ openModeByShell: { ...store.global.openModeByShell, [shell]: value } }); }); }} />
      </Field>
    </SettingsGroup>
    <SettingsGroup title={t('Menu and defaults')}>
      <Field title={t('Default profile')}><Toggle label={t('Default profile')} on={defaultShell === shell} onChange={enabled => save(() => useTerminalDefaults.getState().setShell(enabled ? shell : 'system'))} /></Field>
      <Field title={t('Show in new terminal menu')}><Toggle label={t('Show in new terminal menu')} on={!profile.hidden} onChange={value => set({ hidden: !value })} /></Field>
    </SettingsGroup>
  </div>;
}
