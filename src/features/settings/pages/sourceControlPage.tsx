import Select from '@ui/Select';
import { t } from '@i18n';
import { useGitPreferences } from '@config/git';
import { SettingsGroup, Field } from '../components/ui';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export function SourceControlPage() {
  const mode = useGitPreferences(state => state.diffMode);
  const { save } = useSettingsSave();
  return <SettingsGroup title={t('Source control')}>
    <Field title={t('Diff pages')} description={t('Group comparisons in one page with horizontal tabs, or open each comparison as a separate workspace page.')}>
      <Select aria-label={t('Diff pages')} value={mode} onChange={next => { void save(() => useGitPreferences.getState().setDiffMode(next)); }} options={[
        { value: 'single', label: t('One page with comparison tabs') },
        { value: 'multiple', label: t('Separate pages without comparison tabs') },
      ]} />
    </Field>
  </SettingsGroup>;
}
